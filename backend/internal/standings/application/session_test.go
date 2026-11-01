package application

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type memoryRepository struct {
	submissions map[int]domain.Submission
	revision    int64
}

func (repository *memoryRepository) SaveContest(domain.Contest, time.Time) error { return nil }
func (repository *memoryRepository) LoadActive() ([]StoredContest, error)        { return nil, nil }
func (repository *memoryRepository) LoadSubmissions(int) (map[int]domain.Submission, error) {
	return repository.submissions, nil
}
func (repository *memoryRepository) SaveSubmissions(_ int, submissions []domain.Submission) (int, error) {
	return len(submissions), nil
}
func (repository *memoryRepository) BumpRevision(int, string, bool, time.Time) (int64, error) {
	repository.revision++
	return repository.revision, nil
}
func (repository *memoryRepository) CleanupExpired(time.Time) error { return nil }

type staticGateway struct {
	standings        domain.Standings
	submissions      []domain.Submission
	submissionsError error
	standingsError   error
}

func (gateway staticGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return gateway.submissions, gateway.submissionsError
}
func (gateway staticGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	return gateway.standings, gateway.standingsError
}

func TestSubscriberReceivesSnapshotThenPatch(t *testing.T) {
	contest := domain.Contest{ID: 1, Phase: "CODING"}
	standings := domain.Standings{Contest: contest}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	gateway := staticGateway{standings: standings, submissions: []domain.Submission{{ID: 1, Author: domain.Party{Members: []domain.Member{{Handle: "tourist"}}}}}}
	session := newSession(repository, gateway, time.Hour, contest, &standings, 1, repository.submissions, nil)
	subscriber := session.Subscribe([]string{"tourist"})
	if event := <-subscriber.Events; event.Kind != "snapshot" {
		t.Fatalf("expected snapshot, got %s", event.Kind)
	}
	if !session.poll(context.Background()) {
		t.Fatal("coding session unexpectedly stopped")
	}
	event := <-subscriber.Events
	patch, ok := event.Payload.(Patch)
	if event.Kind != "patch" || !ok || len(patch.SubmissionUpserts) != 1 || patch.SubmissionUpserts[0].ID != 1 {
		t.Fatalf("unexpected patch: %#v", event)
	}
	session.Unsubscribe(subscriber)
}

type historyObserver struct{ missing []int }

func (observer *historyObserver) ObserveSubmissionHistory(missing int) {
	observer.missing = append(observer.missing, missing)
}

func TestSubmissionHistoryOmissionsAndRecovery(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	contest := domain.Contest{ID: 42, Phase: "CODING"}
	standings := domain.Standings{Contest: contest}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	observer := &historyObserver{}
	session := newSession(repository, staticGateway{}, time.Hour, contest, &standings, 0, repository.submissions, observer)
	for _, response := range []struct {
		ids          []int
		err          error
		standingsErr error
	}{
		{ids: []int{101, 102}},
		// Same response size, but the first submission has disappeared.
		{ids: []int{102, 103}},
		{ids: []int{102, 103}},
		{err: errors.New("upstream unavailable")},
		{ids: []int{}},
		// Even when standings fails, a successful status response is observed.
		{ids: []int{101, 102, 103}, standingsErr: errors.New("standings unavailable")},
	} {
		var submissions []domain.Submission
		for _, id := range response.ids {
			submissions = append(submissions, domain.Submission{ID: id})
		}
		session.gateway = staticGateway{standings: standings, submissions: submissions, submissionsError: response.err, standingsError: response.standingsErr}
		if !session.poll(context.Background()) {
			t.Fatal("coding session stopped")
		}
	}
	if !reflect.DeepEqual(observer.missing, []int{0, 1, 1, 3, 0}) {
		t.Fatalf("observations: %v", observer.missing)
	}
	if len(session.submissions) != 3 {
		t.Fatalf("history lost submissions: %v", session.submissions)
	}
	for _, id := range []int{101, 102, 103} {
		if _, ok := session.submissions[id]; !ok {
			t.Fatalf("lost submission %d", id)
		}
	}
	if strings.Count(logs.String(), `"msg":"Codeforces submission history incomplete"`) != 1 || strings.Count(logs.String(), `"msg":"Codeforces submission history recovered"`) != 1 {
		t.Fatalf("expected transition logs only: %s", logs.String())
	}
}

func TestSubmissionHistoryComparesRestoredIDs(t *testing.T) {
	contest := domain.Contest{ID: 42, Phase: "CODING"}
	standings := domain.Standings{Contest: contest}
	stored := map[int]domain.Submission{101: {ID: 101}, 102: {ID: 102}}
	repository := &memoryRepository{submissions: stored}
	observer := &historyObserver{}
	gateway := staticGateway{standings: standings, submissions: []domain.Submission{{ID: 102}}}
	session := newSession(repository, gateway, time.Hour, contest, &standings, 1, stored, observer)
	session.poll(context.Background())
	if !reflect.DeepEqual(observer.missing, []int{1}) {
		t.Fatalf("restored observations: %v", observer.missing)
	}
	if len(session.submissions) != 2 {
		t.Fatal("restored history was truncated")
	}
}

func TestSubmissionHistoryDoesNotTreatVerdictUpdatesAsOmissions(t *testing.T) {
	contest := domain.Contest{ID: 42, Phase: "CODING"}
	standings := domain.Standings{Contest: contest}
	stored := map[int]domain.Submission{101: {ID: 101, Verdict: "TESTING"}}
	repository := &memoryRepository{submissions: stored}
	observer := &historyObserver{}
	gateway := staticGateway{standings: standings, submissions: []domain.Submission{{ID: 101, Verdict: "OK"}}}
	session := newSession(repository, gateway, time.Hour, contest, &standings, 1, stored, observer)
	session.poll(context.Background())
	if !reflect.DeepEqual(observer.missing, []int{0}) {
		t.Fatalf("verdict update observations: %v", observer.missing)
	}
	if session.submissions[101].Verdict != "OK" {
		t.Fatal("verdict update was lost")
	}
}

func (gateway staticGateway) FetchHacks(context.Context, int) ([]domain.Hack, error) { return nil, nil }

type hackTestGateway struct {
	staticGateway
	hacks []domain.Hack
	err   error
	calls int
}

func (gateway *hackTestGateway) FetchHacks(context.Context, int) ([]domain.Hack, error) {
	gateway.calls++
	return gateway.hacks, gateway.err
}

func TestHackEnrichmentRetainsIDsUpdatesVerdictsAndDoesNotBlockStandings(t *testing.T) {
	party := domain.Party{Members: []domain.Member{{Handle: "Member"}}, TeamName: "Team One", ParticipantType: "CONTESTANT"}
	defender := domain.Party{Members: []domain.Member{{Handle: "Defender"}}, ParticipantType: "CONTESTANT"}
	contest := domain.Contest{ID: 42, Phase: "CODING"}
	standings := domain.Standings{Contest: contest, Rows: []domain.RanklistRow{{Party: party, SuccessfulHackCount: 1}}}
	gateway := &hackTestGateway{staticGateway: staticGateway{standings: standings}, hacks: []domain.Hack{
		{ID: 1, Hacker: party, Defender: defender, Verdict: "HACK_SUCCESSFUL"},
		{ID: 1, Hacker: party, Defender: defender, Verdict: "HACK_SUCCESSFUL"},
	}}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	session := newSession(repository, gateway, time.Second, contest, &standings, 0, repository.submissions, nil)
	if !session.poll(context.Background()) {
		t.Fatal("coding collection stopped")
	}
	if len(session.hacks) != 1 {
		t.Fatal("duplicate IDs retained")
	}
	session.poll(context.Background())
	if gateway.calls != 1 {
		t.Fatal("hack requests were not paced")
	}
	for _, handles := range [][]string{{"member"}, {"team one"}, {"DEFENDER"}, {"member", "defender"}} {
		subscriber := session.Subscribe(handles)
		snapshot := (<-subscriber.Events).Payload.(Snapshot)
		if len(snapshot.Hacks) != 1 || !snapshot.HacksIncomplete {
			t.Fatalf("unexpected selected snapshot: %#v", snapshot)
		}
		session.Unsubscribe(subscriber)
	}
	gateway.hacks = nil
	gateway.err = errors.New("hacks unavailable")
	session.lastHackFetch = time.Now().Add(-31 * time.Second)
	session.poll(context.Background())
	if session.stale || len(session.hacks) != 1 || session.hacksLoaded {
		t.Fatal("optional failure damaged standings or lost events")
	}
	gateway.err = nil
	session.lastHackFetch = time.Now().Add(-31 * time.Second)
	session.poll(context.Background())
	if len(session.hacks) != 1 {
		t.Fatal("partial response removed known event")
	}
	gateway.hacks = []domain.Hack{{ID: 1, Hacker: party, Defender: defender, Verdict: "HACK_UNSUCCESSFUL"}}
	session.lastHackFetch = time.Now().Add(-31 * time.Second)
	session.poll(context.Background())
	if session.hacks[1].Verdict != "HACK_UNSUCCESSFUL" {
		t.Fatal("latest verdict was not retained")
	}
	gateway.standings.Contest.Phase = "FINISHED"
	session.poll(context.Background())
	if !session.hacksIncompleteLocked(nil) {
		t.Fatal("count mismatch was not detected")
	}
	gateway.standings.Rows[0].SuccessfulHackCount = 0
	gateway.standings.Rows[0].UnsuccessfulHackCount = 1
	session.poll(context.Background())
	if session.hacksIncompleteLocked(nil) {
		t.Fatal("complete final data was marked incomplete")
	}
}

func TestFinishedContestRetriesMissingHackDetailsForTenMinutes(t *testing.T) {
	contest := domain.Contest{ID: 42, Phase: "FINISHED"}
	standings := domain.Standings{Contest: contest}
	gateway := &hackTestGateway{staticGateway: staticGateway{standings: standings}, err: errors.New("not published yet")}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	session := newSession(repository, gateway, time.Second, contest, &standings, 0, repository.submissions, nil)
	session.poll(context.Background())
	if !session.poll(context.Background()) {
		t.Fatal("stopped before delayed hack data could be published")
	}
	session.finishObserved = time.Now().Add(-10 * time.Minute)
	if session.poll(context.Background()) {
		t.Fatal("retry window did not expire")
	}
}

func TestFinishedContestKeepsPollingPendingJudging(t *testing.T) {
	contest := domain.Contest{ID: 42, Phase: "FINISHED", DurationSeconds: 7200}
	standings := domain.Standings{Contest: contest}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	gateway := staticGateway{standings: standings, submissions: []domain.Submission{{ID: 1, Verdict: "SUBMITTED", RelativeTimeSeconds: 7000}}}
	session := newSession(repository, gateway, time.Second, contest, &standings, 0, repository.submissions, nil)
	session.poll(context.Background())
	if !session.poll(context.Background()) {
		t.Fatal("collector stopped before pending verdict settled")
	}
	gateway.submissions[0].Verdict = "OK"
	session.gateway = gateway
	if session.poll(context.Background()) {
		t.Fatal("collector did not finish after verdict settled")
	}
}
