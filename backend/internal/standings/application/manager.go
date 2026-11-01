package application

import (
	"context"
	"errors"
	"fmt"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"strings"
	"sync"
	"time"
)

type Config struct {
	SubmissionHistoryObserver SubmissionHistoryObserver
	PollInterval              time.Duration
	RetentionPeriod           time.Duration
	MaxActiveContests         int
}

type Manager struct {
	repository Repository
	gateway    ContestGateway
	config     Config
	mu         sync.Mutex
	sessions   map[int]*Session
	activating int
	pending    map[int]chan struct{}
	life       context.Context
	cancel     context.CancelFunc
	activeWG   sync.WaitGroup
	stopping   bool
}

func NewManager(repository Repository, gateway ContestGateway, config Config) *Manager {
	life, cancel := context.WithCancel(context.Background())
	return &Manager{life: life, cancel: cancel, pending: make(map[int]chan struct{}), repository: repository, gateway: gateway, config: config, sessions: make(map[int]*Session)}
}

func (manager *Manager) Restore(ctx context.Context) error {
	if manager.config.RetentionPeriod > 0 {
		if err := manager.repository.CleanupExpired(time.Now().Add(-manager.config.RetentionPeriod)); err != nil {
			return err
		}
	}
	records, err := manager.repository.LoadActive()
	if err != nil {
		return err
	}
	for _, record := range records {
		stored, err := manager.repository.LoadSubmissions(record.Contest.ID)
		if err != nil {
			return err
		}
		session := newSession(manager.repository, manager.gateway, manager.config.PollInterval, record.Contest, nil, record.Revision, stored, manager.config.SubmissionHistoryObserver)
		if store, ok := manager.repository.(ViewRepository); ok {
			view, err := store.LoadView(record.Contest.ID)
			if err != nil {
				return err
			}
			if view != nil {
				session.standings = &view.Standings
				session.submissions = view.Submissions
				session.stale = !view.Finished
				session.finished = view.Finished
				if view.Finished {
					session.finishedAt = time.Now()
					if record.FinishedAt != nil {
						session.finishedAt = *record.FinishedAt
					}
				}
			}
		}
		manager.sessions[record.Contest.ID] = session
		if session.finished {
			close(session.stopped)
		} else {
			go session.Run(ctx)
		}
	}
	return nil
}

func (manager *Manager) Activate(ctx context.Context, id int) (*Session, bool, error) {
	manager.mu.Lock()
	if manager.stopping {
		manager.mu.Unlock()
		return nil, false, context.Canceled
	}
	if pending := manager.pending[id]; pending != nil {
		manager.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, false, ctx.Err()
		case <-manager.life.Done():
			return nil, false, context.Canceled
		case <-pending:
			return manager.Activate(ctx, id)
		}
	}
	if session := manager.sessions[id]; session != nil {
		manager.mu.Unlock()
		return session, false, nil
	}
	active := manager.activating
	for _, session := range manager.sessions {
		finished, _ := session.Status()
		if !finished {
			active++
		}
	}
	if active >= manager.config.MaxActiveContests {
		manager.mu.Unlock()
		return nil, false, errors.New("active contest capacity reached")
	}
	manager.activating++
	manager.pending[id] = make(chan struct{})
	manager.activeWG.Add(1)
	manager.mu.Unlock()
	defer func() {
		manager.mu.Lock()
		manager.activating--
		close(manager.pending[id])
		delete(manager.pending, id)
		manager.activeWG.Done()
		manager.mu.Unlock()
	}()

	ctx, cancel := context.WithCancel(ctx)
	stopCancel := context.AfterFunc(manager.life, cancel)
	defer func() { stopCancel(); cancel() }()
	var standings domain.Standings
	var initial *ContestUpdate
	var err error
	if source, ok := manager.gateway.(ContestSource); ok {
		value, sourceErr := source.InitialUpdate(ctx, id)
		err = sourceErr
		initial = &value
		standings = value.Standings
	} else {
		standings, err = manager.gateway.FetchStandings(ctx, id)
	}
	activated := false
	defer func() {
		if !activated {
			if source, ok := manager.gateway.(StreamingGateway); ok {
				source.StopContest(id)
			}
		}
	}()
	if err != nil {
		return nil, false, err
	}
	finished := strings.EqualFold(standings.Contest.Phase, "FINISHED")
	_, authoritative := manager.gateway.(StreamingGateway)
	if !authoritative && standings.Contest.Phase != "BEFORE" && standings.Contest.Phase != "CODING" && !finished {
		return nil, false, fmt.Errorf("contest is %s", standings.Contest.Phase)
	}
	activatedAt := time.Now()
	if err := manager.repository.SaveContest(standings.Contest, activatedAt); err != nil {
		return nil, false, err
	}
	stored, err := manager.repository.LoadSubmissions(id)
	if err != nil {
		return nil, false, err
	}
	revision := int64(0)
	if store, ok := manager.repository.(ViewRepository); ok {
		saved, loadErr := store.LoadView(id)
		if loadErr != nil {
			return nil, false, loadErr
		}
		if saved != nil {
			for key, value := range saved.Submissions {
				stored[key] = value
			}
		}
	}
	if initial != nil {
		for key, value := range initial.Submissions {
			stored[key] = value
		}
		initial.Submissions = stored
		if _, ok := manager.repository.(ViewRepository); !ok {
			values := make([]domain.Submission, 0, len(stored))
			for _, item := range stored {
				values = append(values, item)
			}
			if _, err := manager.repository.SaveSubmissions(id, values); err != nil {
				return nil, false, err
			}
		}
		if store, ok := manager.repository.(ViewRepository); ok {
			if err := store.SaveView(id, *initial, revision); err != nil {
				return nil, false, err
			}
		}
	}
	session := newSession(manager.repository, manager.gateway, manager.config.PollInterval, standings.Contest, &standings, revision, stored, manager.config.SubmissionHistoryObserver)
	if initial != nil && authoritative {
		session.finished = initial.Finished
		if session.finished {
			session.finishedAt = time.Now()
		}
	}
	manager.mu.Lock()
	if existing := manager.sessions[id]; existing != nil {
		manager.mu.Unlock()
		activated = true
		return existing, false, nil
	}
	manager.sessions[id] = session
	manager.mu.Unlock()
	activated = true
	go session.Run(context.Background())
	return session, true, nil
}

func (manager *Manager) Get(id int) *Session {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.sessions[id]
}

func (manager *Manager) Cleanup(now time.Time) {
	manager.mu.Lock()
	for id, session := range manager.sessions {
		finished, finishedAt := session.Status()
		if finished && now.Sub(finishedAt) >= manager.config.RetentionPeriod {
			session.Stop()
			delete(manager.sessions, id)
		}
	}
	manager.mu.Unlock()
	if err := manager.repository.CleanupExpired(now.Add(-manager.config.RetentionPeriod)); err != nil { /* retried by next cycle */
	}
}

func (manager *Manager) RunCleanup(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case now := <-ticker.C:
			manager.Cleanup(now)
		case <-ctx.Done():
			return
		}
	}
}

func (manager *Manager) Stop() {
	manager.mu.Lock()
	manager.stopping = true
	manager.cancel()
	manager.mu.Unlock()
	manager.activeWG.Wait()
	manager.mu.Lock()
	sessions := make([]*Session, 0, len(manager.sessions))
	for _, session := range manager.sessions {
		sessions = append(sessions, session)
	}
	manager.mu.Unlock()
	for _, session := range sessions {
		session.Stop()
	}
	for _, session := range sessions {
		<-session.Stopped()
	}
}
