package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

func TestSourcesPersistViewsIndependentlyAndDeleteEntities(t *testing.T) {
	path := filepath.Join(t.TempDir(), "views.sqlite")
	repository, err := sqlite.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"codeforces", "livev3"} {
		store, err := repository.Scope(source)
		if err != nil {
			t.Fatal(err)
		}
		view := application.ContestUpdate{Standings: domain.Standings{Contest: domain.Contest{ID: 1, Name: source, Phase: "CODING"}, Rows: []domain.RanklistRow{{Points: 430, Rank: 2}}}, Submissions: map[int]domain.Submission{101: {ID: 101, PassedTestCount: 23}}, Entities: map[string]map[string][]byte{"submissions": {"101": []byte(`{"id":101}`)}}}
		if err := store.SaveView(1, view, 9); err != nil {
			t.Fatal(err)
		}
	}
	repository.Close()
	repository, err = sqlite.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	for _, source := range []string{"codeforces", "livev3"} {
		store, _ := repository.Scope(source)
		view, err := store.LoadView(1)
		if err != nil {
			t.Fatal(err)
		}
		if view.Standings.Contest.Name != source || view.Standings.Rows[0].Points != 430 || view.Submissions[101].PassedTestCount != 23 || view.Standings.Authoritative != (source == "livev3") {
			t.Fatal(view)
		}
		rows, err := store.LoadActive()
		if err != nil || len(rows) != 1 || rows[0].Revision != 9 {
			t.Fatal(rows, err)
		}
		delete(view.Entities["submissions"], "101")
		delete(view.Submissions, 101)
		view.Finished = true
		if err := store.SaveView(1, *view, 10); err != nil {
			t.Fatal(err)
		}
		view, err = store.LoadView(1)
		if err != nil || len(view.Submissions) != 0 || len(view.Entities["submissions"]) != 0 {
			t.Fatal(view, err)
		}
		if err := store.CleanupExpired(time.Now().Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
		view, err = store.LoadView(1)
		if err != nil || view != nil {
			t.Fatal(view, err)
		}
	}
}

type waitingSource struct {
	started chan int
	stopped chan int
}

func (s *waitingSource) FetchStandings(context.Context, int) (domain.Standings, error) {
	panic("restore must use retained view")
}
func (s *waitingSource) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	panic("stream must not poll")
}
func (s *waitingSource) Stream(ctx context.Context, id int, publish func(application.ContestUpdate) error) error {
	s.started <- id
	<-ctx.Done()
	return ctx.Err()
}
func (s *waitingSource) StopContest(id int) { s.stopped <- id }
func TestRestoreRetainsStaleAndFinishedViewsAndShutsDownWorker(t *testing.T) {
	repository, err := sqlite.Open(filepath.Join(t.TempDir(), "restore.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	store, _ := repository.Scope("livev3")
	for id := 1; id <= 2; id++ {
		view := application.ContestUpdate{Standings: domain.Standings{Contest: domain.Contest{ID: id, Phase: "CODING"}}, Submissions: map[int]domain.Submission{101: {ID: 101, Verdict: "OK", Author: domain.Party{Members: []domain.Member{{Handle: "alice"}}}}}, Finished: id == 2}
		if err := store.SaveView(id, view, 7); err != nil {
			t.Fatal(err)
		}
	}
	source := &waitingSource{started: make(chan int, 2), stopped: make(chan int, 2)}
	manager := application.NewManager(store, source, application.Config{MaxActiveContests: 1, RetentionPeriod: time.Hour})
	if err := manager.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-source.started:
		if id != 1 {
			t.Fatal(id)
		}
	case <-time.After(time.Second):
		t.Fatal("worker not restored")
	}
	for id, state := range map[int]string{1: "stale", 2: "finished"} {
		feed, err := manager.SubscribeContest(context.Background(), id, []string{"alice"})
		if err != nil {
			t.Fatal(err)
		}
		event := <-feed.Events
		snapshot := event.Payload.(application.Snapshot)
		if snapshot.Health.State != state || snapshot.Revision != 7 || snapshot.Submissions[0].Verdict != "OK" {
			t.Fatal(snapshot)
		}
		feed.Close()
	}
	if _, _, err := manager.Activate(context.Background(), 3); err == nil {
		t.Fatal("capacity not enforced")
	}
	manager.Stop()
	select {
	case id := <-source.stopped:
		if id != 1 {
			t.Fatal(id)
		}
	default:
		t.Fatal("worker not stopped")
	}
	select {
	case id := <-source.started:
		t.Fatalf("finished worker restarted: %d", id)
	default:
	}
}
