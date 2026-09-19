package application

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type countingGateway struct {
	mu              sync.Mutex
	standings       domain.Standings
	standingsCalls  int
	submissionCalls int
}

func (gateway *countingGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	gateway.mu.Lock()
	gateway.standingsCalls++
	gateway.mu.Unlock()
	return gateway.standings, nil
}

func (gateway *countingGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	gateway.mu.Lock()
	gateway.submissionCalls++
	gateway.mu.Unlock()
	return nil, nil
}

func (gateway *countingGateway) calls() (int, int) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	return gateway.standingsCalls, gateway.submissionCalls
}

func TestFinishedContestRunsShortPollingLifecycle(t *testing.T) {
	contest := domain.Contest{ID: 1, Phase: "FINISHED"}
	gateway := &countingGateway{standings: domain.Standings{Contest: contest}}
	repository := &memoryRepository{submissions: make(map[int]domain.Submission)}
	manager := NewManager(repository, gateway, Config{
		PollInterval:      time.Millisecond,
		RetentionPeriod:   time.Hour,
		MaxActiveContests: 3,
	})
	t.Cleanup(manager.Stop)

	session, created, err := manager.Activate(context.Background(), contest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("expected a new session")
	}
	subscriber := session.Subscribe(nil)
	t.Cleanup(func() { session.Unsubscribe(subscriber) })

	if event := <-subscriber.Events; event.Kind != "snapshot" {
		t.Fatalf("expected initial snapshot, got %s", event.Kind)
	}
	deadline := time.After(time.Second)
	for {
		select {
		case event := <-subscriber.Events:
			if event.Kind == "state" {
				state := event.Payload.(State)
				if state.State != "finished" {
					t.Fatalf("expected finished state, got %s", state.State)
				}
				standingsCalls, submissionCalls := gateway.calls()
				if standingsCalls < 3 || submissionCalls < 2 {
					t.Fatalf("finished contest did not use the normal short polling lifecycle: standings=%d submissions=%d", standingsCalls, submissionCalls)
				}
				return
			}
		case <-deadline:
			t.Fatal("finished contest did not reach finished state")
		}
	}
}
