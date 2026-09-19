package application

import (
	"context"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type Event struct {
	Kind     string
	Revision int64
	Payload  any
}

type Snapshot struct {
	Revision    int64               `json:"revision"`
	Contest     domain.Contest      `json:"contest"`
	Standings   domain.Standings    `json:"standings"`
	Submissions []domain.Submission `json:"submissions"`
	Health      Health              `json:"health"`
}

type Patch struct {
	Revision          int64               `json:"revision"`
	Contest           domain.Contest      `json:"contest"`
	Standings         domain.Standings    `json:"standings"`
	SubmissionUpserts []domain.Submission `json:"submissionUpserts"`
	Health            Health              `json:"health"`
}

type Health struct {
	State string `json:"state"`
}
type State struct {
	State   string         `json:"state"`
	Contest domain.Contest `json:"contest"`
}

type Subscription struct {
	Handles domain.HandleSet
	Events  chan Event
	Done    chan struct{}
}

type Session struct {
	repository   Repository
	gateway      ContestGateway
	pollInterval time.Duration

	mu            sync.RWMutex
	contest       domain.Contest
	submissions   map[int]domain.Submission
	standings     *domain.Standings
	subscribers   map[*Subscription]struct{}
	revision      int64
	finishedPolls int
	finished      bool
	finishedAt    time.Time
	stale         bool
	stop          chan struct{}
	stopped       chan struct{}
	stopOnce      sync.Once
}

func newSession(repository Repository, gateway ContestGateway, pollInterval time.Duration, contest domain.Contest, standings *domain.Standings, revision int64, stored map[int]domain.Submission) *Session {
	return &Session{repository: repository, gateway: gateway, pollInterval: pollInterval, contest: contest, standings: standings, revision: revision, submissions: stored, subscribers: make(map[*Subscription]struct{}), stop: make(chan struct{}), stopped: make(chan struct{})}
}

func (session *Session) Contest() domain.Contest {
	session.mu.RLock()
	defer session.mu.RUnlock()
	return session.contest
}

func (session *Session) Status() (bool, time.Time) {
	session.mu.RLock()
	defer session.mu.RUnlock()
	return session.finished, session.finishedAt
}

func (session *Session) Subscribe(handles []string) *Subscription {
	subscription := &Subscription{Handles: domain.NewHandleSet(handles), Events: make(chan Event, 2), Done: make(chan struct{})}
	session.mu.Lock()
	session.subscribers[subscription] = struct{}{}
	if session.standings == nil {
		subscription.Events <- Event{Kind: "state", Revision: session.revision, Payload: State{State: "warming", Contest: session.contest}}
	} else {
		subscription.Events <- session.snapshotLocked(subscription)
		state := session.healthStateLocked()
		if state != "live" {
			subscription.Events <- Event{Kind: "state", Revision: session.revision, Payload: State{State: state, Contest: session.contest}}
		}
	}
	session.mu.Unlock()
	return subscription
}

func (session *Session) Unsubscribe(subscription *Subscription) {
	session.mu.Lock()
	if _, ok := session.subscribers[subscription]; ok {
		delete(session.subscribers, subscription)
		close(subscription.Done)
	}
	session.mu.Unlock()
}

func (session *Session) snapshotLocked(subscription *Subscription) Event {
	standings, submissions := domain.Project(session.contest, session.standings, session.submissions, subscription.Handles)
	return Event{Kind: "snapshot", Revision: session.revision, Payload: Snapshot{Revision: session.revision, Contest: session.contest, Standings: standings, Submissions: submissions, Health: Health{State: session.healthStateLocked()}}}
}

func (session *Session) healthStateLocked() string {
	if session.finished {
		return "finished"
	}
	if session.stale {
		return "stale"
	}
	return "live"
}

func (session *Session) patchLocked(subscription *Subscription, upserts []domain.Submission) Event {
	standings, _ := domain.Project(session.contest, session.standings, session.submissions, subscription.Handles)
	selected := make([]domain.Submission, 0, len(upserts))
	for _, submission := range upserts {
		if subscription.Handles.Selects(submission.Author) {
			selected = append(selected, submission)
		}
	}
	return Event{Kind: "patch", Revision: session.revision, Payload: Patch{Revision: session.revision, Contest: session.contest, Standings: standings, SubmissionUpserts: selected, Health: Health{State: "live"}}}
}

func (session *Session) Run(ctx context.Context) {
	defer close(session.stopped)
	contest := session.Contest()
	if wait := time.Until(time.Unix(contest.StartTimeSeconds, 0)); contest.Phase == "BEFORE" && wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return
		case <-session.stop:
			return
		}
	}
	if !session.poll(ctx) {
		return
	}
	ticker := time.NewTicker(session.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if !session.poll(ctx) {
				return
			}
		case <-ctx.Done():
			return
		case <-session.stop:
			return
		}
	}
}

func (session *Session) Stop()                    { session.stopOnce.Do(func() { close(session.stop) }) }
func (session *Session) Stopped() <-chan struct{} { return session.stopped }

func (session *Session) poll(ctx context.Context) bool {
	contestID := session.Contest().ID
	session.mu.RLock()
	previousContest := session.contest
	previousStandings := session.standings
	session.mu.RUnlock()
	status, statusErr := session.gateway.FetchSubmissions(ctx, contestID)
	changed := make([]domain.Submission, 0)
	if statusErr == nil {
		if count, err := session.repository.SaveSubmissions(contestID, status); err != nil {
			statusErr = err
		} else {
			if count > 0 {
				slog.Info("submissions reconciled", "contest", contestID, "changed", count)
			}
			session.mu.Lock()
			for _, submission := range status {
				if previous, ok := session.submissions[submission.ID]; !ok || !reflect.DeepEqual(previous, submission) {
					changed = append(changed, submission)
				}
				session.submissions[submission.ID] = submission
			}
			session.mu.Unlock()
		}
	}
	standings, standingsErr := session.gateway.FetchStandings(ctx, contestID)
	if standingsErr == nil {
		session.mu.Lock()
		session.standings = &standings
		session.contest = standings.Contest
		session.mu.Unlock()
		if err := session.repository.SaveContest(standings.Contest, time.Now()); err != nil {
			standingsErr = err
		}
	}
	if statusErr != nil || standingsErr != nil {
		slog.Warn("contest poll incomplete", "contest", contestID, "status_error", statusErr, "standings_error", standingsErr)
		session.mu.Lock()
		session.stale = true
		session.mu.Unlock()
		session.broadcastState("stale")
		return true
	}
	finished := strings.EqualFold(standings.Contest.Phase, "FINISHED")
	if finished {
		session.finishedPolls++
	} else {
		session.finishedPolls = 0
	}
	now := time.Now()
	revision, err := session.repository.BumpRevision(contestID, standings.Contest.Phase, finished, now)
	if err != nil {
		slog.Error("revision update failed", "error", err)
		return true
	}
	session.mu.Lock()
	wasStale := session.stale
	session.stale = false
	session.revision = revision
	session.mu.Unlock()
	standingsChanged := previousStandings == nil || !reflect.DeepEqual(*previousStandings, standings)
	contestChanged := !reflect.DeepEqual(previousContest, standings.Contest)
	if len(changed) > 0 || standingsChanged || contestChanged || wasStale {
		session.broadcast(changed)
	}
	if finished && session.finishedPolls >= 2 {
		session.mu.Lock()
		session.finished = true
		session.finishedAt = now
		session.mu.Unlock()
		session.broadcastState("finished")
		return false
	}
	return true
}

func (session *Session) broadcast(upserts []domain.Submission) {
	session.mu.Lock()
	defer session.mu.Unlock()
	for subscriber := range session.subscribers {
		session.offer(subscriber, session.patchLocked(subscriber, upserts), true)
	}
}

func (session *Session) broadcastState(state string) {
	session.mu.Lock()
	defer session.mu.Unlock()
	event := Event{Kind: "state", Revision: session.revision, Payload: State{State: state, Contest: session.contest}}
	for subscriber := range session.subscribers {
		session.offer(subscriber, event, false)
	}
}

func (session *Session) offer(subscriber *Subscription, event Event, replace bool) {
	select {
	case subscriber.Events <- event:
		return
	default:
	}
	if !replace {
		return
	}
	select {
	case <-subscriber.Events:
	default:
	}
	select {
	case subscriber.Events <- event:
	default:
	}
}
