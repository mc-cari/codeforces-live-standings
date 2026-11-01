package application

import (
	"context"
	"errors"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"sync"
	"testing"
	"time"
)

type settingsMemory struct {
	value CollectionSettings
	err   error
}

func (s *settingsMemory) LoadCollectionSettings() (CollectionSettings, error) { return s.value, nil }
func (s *settingsMemory) SaveCollectionSettings(v CollectionSettings) error {
	if s.err != nil {
		return s.err
	}
	s.value = v
	return nil
}

type collectionGateway struct {
	mu        sync.Mutex
	contests  []domain.Contest
	err       error
	fail      map[int]bool
	calls     int
	activated []int
}

func (g *collectionGateway) FetchContests(context.Context) ([]domain.Contest, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.calls++
	return append([]domain.Contest{}, g.contests...), g.err
}
func (g *collectionGateway) FetchStandings(_ context.Context, id int) (domain.Standings, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.fail[id] {
		return domain.Standings{}, errors.New("upstream unavailable")
	}
	for _, c := range g.contests {
		if c.ID == id {
			g.activated = append(g.activated, id)
			return domain.Standings{Contest: c}, nil
		}
	}
	return domain.Standings{}, errors.New("unknown contest")
}
func (g *collectionGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return nil, nil
}

type concurrentRepository struct {
	mu    sync.Mutex
	saves map[int]int
}

func (r *concurrentRepository) SaveContest(c domain.Contest, _ time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.saves[c.ID]++
	return nil
}
func (r *concurrentRepository) LoadActive() ([]StoredContest, error) { return nil, nil }
func (r *concurrentRepository) LoadSubmissions(int) (map[int]domain.Submission, error) {
	return map[int]domain.Submission{}, nil
}
func (r *concurrentRepository) SaveSubmissions(int, []domain.Submission) (int, error) { return 0, nil }
func (r *concurrentRepository) BumpRevision(int, string, bool, time.Time) (int64, error) {
	return 1, nil
}
func (r *concurrentRepository) CleanupExpired(time.Time) error { return nil }
func collectionFixture(t *testing.T, contests []domain.Contest) (*Collector, *collectionGateway, *Manager, *settingsMemory, *time.Time) {
	t.Helper()
	gateway := &collectionGateway{contests: contests, fail: map[int]bool{}}
	store := &settingsMemory{value: DefaultCollectionSettings()}
	manager := NewManager(&concurrentRepository{saves: map[int]int{}}, gateway, Config{PollInterval: time.Hour, MaxActiveContests: 3})
	collector, err := NewCollector(store, gateway, manager, nil)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(100000, 0)
	collector.now = func() time.Time { return now }
	t.Cleanup(func() {
		manager.Stop()
		for _, s := range manager.Sessions() {
			<-s.Stopped()
		}
	})
	return collector, gateway, manager, store, &now
}
func TestCollectionModesPostponementsAndFailures(t *testing.T) {
	c, g, m, store, now := collectionFixture(t, []domain.Contest{{ID: 1, Phase: "BEFORE", StartTimeSeconds: 1}, {ID: 2, Phase: "SYSTEM_TEST", StartTimeSeconds: 2}, {ID: 3, Phase: "FINISHED"}})
	c.Refresh(context.Background())
	if len(m.Sessions()) != 0 {
		t.Fatal("Off activated a session")
	}
	if err := c.Update(context.Background(), CollectionSettings{Mode: "selected", SelectedContestIDs: []int{1}}); err != nil {
		t.Fatal(err)
	}
	if len(m.Sessions()) != 0 {
		t.Fatal("scheduled time must not activate a postponed contest")
	}
	g.mu.Lock()
	g.contests[0].StartTimeSeconds = 200000
	g.mu.Unlock()
	*now = now.Add(time.Minute)
	c.Refresh(context.Background())
	if len(m.Sessions()) != 0 {
		t.Fatal("postponed contest activated")
	}
	g.mu.Lock()
	g.contests[0].Phase = "CODING"
	g.fail[1] = true
	g.mu.Unlock()
	*now = now.Add(time.Minute)
	c.Refresh(context.Background())
	if len(c.Status().Contests) != 2 || c.Status().Contests[1].ID != 1 || c.Status().Contests[1].CollectionState != "error" {
		t.Fatal("expected activation failure")
	}
	g.mu.Lock()
	g.fail[1] = false
	g.mu.Unlock()
	c.Refresh(context.Background())
	if m.Get(1) == nil {
		t.Fatal("activation was not retried")
	}
	if err := c.Update(context.Background(), CollectionSettings{Mode: "all", SelectedContestIDs: []int{1}}); err != nil {
		t.Fatal(err)
	}
	if m.Get(2) == nil || m.Get(3) != nil {
		t.Fatal("testing must activate, finished must not")
	}
	if err := c.Update(context.Background(), CollectionSettings{Mode: "off", SelectedContestIDs: []int{1}}); err != nil {
		t.Fatal(err)
	}
	if m.Get(1) == nil || len(store.value.SelectedContestIDs) != 1 {
		t.Fatal("Off must preserve sessions and selections")
	}
	store.err = errors.New("disk unavailable")
	if c.Update(context.Background(), CollectionSettings{Mode: "all"}) == nil || c.Settings().Mode != "off" {
		t.Fatal("failed persistence changed settings")
	}
}
func TestCollectionCapacityOrderAndRetry(t *testing.T) {
	c, _, m, _, _ := collectionFixture(t, []domain.Contest{{ID: 4, Phase: "CODING", StartTimeSeconds: 2}, {ID: 3, Phase: "CODING", StartTimeSeconds: 1}, {ID: 1, Phase: "CODING", StartTimeSeconds: 1}, {ID: 2, Phase: "CODING", StartTimeSeconds: 1}})
	if err := c.Update(context.Background(), CollectionSettings{Mode: "all"}); err != nil {
		t.Fatal(err)
	}
	if m.Get(4) != nil || c.Status().Waiting != 1 {
		t.Fatal("capacity must queue the latest contest")
	}
	first := m.Get(1)
	first.Stop()
	<-first.Stopped()
	first.mu.Lock()
	first.finished = true
	first.mu.Unlock()
	c.Refresh(context.Background())
	if m.Get(4) == nil || c.Status().Waiting != 0 {
		t.Fatal("free capacity was not retried")
	}
}
func TestDiscoveryFailureDoesNotActivateStaleSchedule(t *testing.T) {
	c, g, m, _, now := collectionFixture(t, []domain.Contest{{ID: 1, Phase: "CODING"}})
	c.Refresh(context.Background())
	g.mu.Lock()
	g.err = errors.New("discovery unavailable")
	g.mu.Unlock()
	*now = now.Add(time.Minute)
	if err := c.Update(context.Background(), CollectionSettings{Mode: "all"}); err != nil {
		t.Fatal(err)
	}
	if len(m.Sessions()) != 0 || !c.Status().DiscoveryStale || c.Status().LatestError == "" {
		t.Fatal("stale discovery activated a contest")
	}
}
func TestConcurrentAutomaticAndViewerActivationShareSession(t *testing.T) {
	c, _, m, _, _ := collectionFixture(t, []domain.Contest{{ID: 1, Phase: "PENDING_SYSTEM_TEST"}})
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := m.Activate(context.Background(), 1); err != nil {
				t.Error(err)
			}
		}()
	}
	if err := c.Update(context.Background(), CollectionSettings{Mode: "all"}); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if len(m.Sessions()) != 1 {
		t.Fatal("duplicate sessions")
	}
	// One activation standings response and one initial session poll, at most.
	g := m.gateway.(*collectionGateway)
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.activated) > 2 {
		t.Fatalf("duplicate activation work: %v", g.activated)
	}
}
func TestCollectionSettingsValidation(t *testing.T) {
	for _, s := range []CollectionSettings{{Mode: "invalid"}, {Mode: "off", SelectedContestIDs: []int{0}}, {Mode: "all", SelectedContestIDs: []int{1, 1}}} {
		if s.Validate() == nil {
			t.Fatalf("accepted %#v", s)
		}
	}
}

type collectionRecorder struct{ waiting, failures int }

func (r *collectionRecorder) ObserveCollection(waiting, failures int) {
	r.waiting = waiting
	r.failures += failures
}
func TestAutomaticActivationFailuresAreObservedAndRetried(t *testing.T) {
	c, g, m, _, _ := collectionFixture(t, []domain.Contest{{ID: 1, Phase: "CODING"}})
	recorder := &collectionRecorder{}
	c.observer = recorder
	g.fail[1] = true
	if err := c.Update(context.Background(), CollectionSettings{Mode: "all"}); err != nil {
		t.Fatal(err)
	}
	if recorder.failures != 1 || recorder.waiting != 0 || m.Get(1) != nil {
		t.Fatal("activation failure metrics missing", recorder)
	}
	g.mu.Lock()
	g.fail[1] = false
	g.mu.Unlock()
	c.Refresh(context.Background())
	if m.Get(1) == nil || recorder.failures != 1 {
		t.Fatal("successful retry did not clear activation error")
	}
	for _, row := range c.Status().Contests {
		if row.LatestError != "" {
			t.Fatal("activation error persisted after successful retry")
		}
	}
}
