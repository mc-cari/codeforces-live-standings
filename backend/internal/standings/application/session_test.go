package application

import (
	"context"
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
	standings   domain.Standings
	submissions []domain.Submission
}

func (gateway staticGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return gateway.submissions, nil
}
func (gateway staticGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	return gateway.standings, nil
}

func TestSubscriberReceivesSnapshotThenPatch(t *testing.T) {
	contest := domain.Contest{ID: 1, Phase: "CODING"}
	standings := domain.Standings{Contest: contest}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	gateway := staticGateway{standings: standings, submissions: []domain.Submission{{ID: 1, Author: domain.Party{Members: []domain.Member{{Handle: "tourist"}}}}}}
	session := newSession(repository, gateway, time.Hour, contest, &standings, 1, repository.submissions)
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
