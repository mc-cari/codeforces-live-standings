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

// Completion must remain recoverable after the first FINISHED response.
type completionRepository struct {
	memoryRepository
	completions []bool
}

func (r *completionRepository) BumpRevision(_ int, _ string, finished bool, _ time.Time) (int64, error) {
	r.completions = append(r.completions, finished)
	return int64(len(r.completions)), nil
}
func TestCompletionPersistsOnlyAfterTwoSuccessfulFinishedPolls(t *testing.T) {
	contest := domain.Contest{ID: 1, Phase: "FINISHED"}
	repository := &completionRepository{memoryRepository: memoryRepository{submissions: map[int]domain.Submission{7: {ID: 7, Author: domain.Party{Members: []domain.Member{{Handle: "tourist"}}}}}}}
	session := newSession(repository, staticGateway{standings: domain.Standings{Contest: contest}}, time.Hour, contest, nil, 0, repository.submissions, nil)
	sub := session.Subscribe([]string{"tourist"})
	defer session.Unsubscribe(sub)
	if (<-sub.Events).Kind != "state" {
		t.Fatal("restored session must begin warming")
	}
	if !session.poll(context.Background()) || repository.completions[0] {
		t.Fatal("first finished poll must remain recoverable")
	}
	event := <-sub.Events
	snapshot, ok := event.Payload.(Snapshot)
	if !ok || len(snapshot.Submissions) != 1 {
		t.Fatal("warming subscriber did not receive full retained history", event)
	}
	if session.poll(context.Background()) || !repository.completions[1] {
		t.Fatal("second finished poll must complete collection")
	}
	state, poll, err := session.CollectionStatus()
	if state != "finished" || poll.IsZero() || err != "" {
		t.Fatal(state, poll, err)
	}
}
