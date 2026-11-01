package application

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type CollectionSettings struct {
	Mode               string `json:"mode"`
	SelectedContestIDs []int  `json:"selectedContestIds"`
}

func DefaultCollectionSettings() CollectionSettings {
	return CollectionSettings{Mode: "off", SelectedContestIDs: []int{}}
}
func (s CollectionSettings) Validate() error {
	if s.Mode != "off" && s.Mode != "selected" && s.Mode != "all" {
		return errors.New("mode must be off, selected, or all")
	}
	if len(s.SelectedContestIDs) > 1000 {
		return errors.New("too many selected contests")
	}
	seen := map[int]bool{}
	for _, id := range s.SelectedContestIDs {
		if id <= 0 || seen[id] {
			return errors.New("contest IDs must be positive and unique")
		}
		seen[id] = true
	}
	return nil
}

type SettingsStore interface {
	LoadCollectionSettings() (CollectionSettings, error)
	SaveCollectionSettings(CollectionSettings) error
}
type DiscoveryGateway interface {
	FetchContests(context.Context) ([]domain.Contest, error)
}
type CollectionObserver interface{ ObserveCollection(int, int) }
type ContestCollection struct {
	domain.Contest
	CollectionState    string    `json:"collectionState"`
	LastSuccessfulPoll time.Time `json:"lastSuccessfulPoll"`
	LatestError        string    `json:"latestError"`
}
type CollectionStatus struct {
	Contests           []ContestCollection `json:"contests"`
	DiscoveryUpdatedAt time.Time           `json:"discoveryUpdatedAt"`
	DiscoveryStale     bool                `json:"discoveryStale"`
	LatestError        string              `json:"latestError"`
	Waiting            int                 `json:"waiting"`
	Capacity           int                 `json:"capacity"`
}
type Collector struct {
	opMu             sync.Mutex
	mu               sync.RWMutex
	settings         CollectionSettings
	contests         []domain.Contest
	updated          time.Time
	latestError      string
	states           map[int]string
	activationErrors map[int]string
	waiting          int
	store            SettingsStore
	gateway          DiscoveryGateway
	manager          *Manager
	observer         CollectionObserver
	now              func() time.Time
}

func NewCollector(store SettingsStore, gateway DiscoveryGateway, manager *Manager, observer CollectionObserver) (*Collector, error) {
	settings, err := store.LoadCollectionSettings()
	if err != nil {
		return nil, err
	}
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	return &Collector{store: store, gateway: gateway, manager: manager, observer: observer, settings: settings, now: time.Now, states: map[int]string{}, activationErrors: map[int]string{}}, nil
}
func (c *Collector) Settings() CollectionSettings {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return CollectionSettings{Mode: c.settings.Mode, SelectedContestIDs: append([]int{}, c.settings.SelectedContestIDs...)}
}
func (c *Collector) Update(ctx context.Context, settings CollectionSettings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	c.opMu.Lock()
	defer c.opMu.Unlock()
	settings.SelectedContestIDs = append([]int{}, settings.SelectedContestIDs...)
	if err := c.store.SaveCollectionSettings(settings); err != nil {
		return err
	}
	c.mu.Lock()
	c.settings = settings
	c.mu.Unlock()
	if settings.Mode == "off" {
		c.mu.Lock()
		c.states = map[int]string{}
		c.activationErrors = map[int]string{}
		c.waiting = 0
		c.mu.Unlock()
		if c.observer != nil {
			c.observer.ObserveCollection(0, 0)
		}
	} else {
		c.reconcile(ctx, false)
	}
	return nil
}

// Refresh uses the same serialized discovery and reconciliation as the timer.
func (c *Collector) Refresh(ctx context.Context) {
	c.opMu.Lock()
	defer c.opMu.Unlock()
	c.reconcile(ctx, false)
}
func (c *Collector) Run(ctx context.Context) {
	c.opMu.Lock()
	c.reconcile(ctx, true)
	c.opMu.Unlock()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if c.Settings().Mode != "off" {
				c.Refresh(ctx)
			}
		}
	}
}
func (c *Collector) reconcile(ctx context.Context, force bool) {
	settings := c.Settings()
	c.mu.RLock()
	stale := c.updated.IsZero() || c.now().Sub(c.updated) >= time.Minute
	contests := append([]domain.Contest{}, c.contests...)
	c.mu.RUnlock()
	if force || stale {
		discovered, err := c.gateway.FetchContests(ctx)
		c.mu.Lock()
		if err != nil {
			c.latestError = "Contest discovery failed: " + err.Error()
			c.mu.Unlock()
			return
		}
		contests = append([]domain.Contest{}, discovered...)
		c.contests = append([]domain.Contest{}, discovered...)
		c.updated = c.now()
		c.latestError = ""
		c.mu.Unlock()
	}
	sort.Slice(contests, func(i, j int) bool {
		if contests[i].StartTimeSeconds != contests[j].StartTimeSeconds {
			return contests[i].StartTimeSeconds < contests[j].StartTimeSeconds
		}
		return contests[i].ID < contests[j].ID
	})
	selected := map[int]bool{}
	for _, id := range settings.SelectedContestIDs {
		selected[id] = true
	}
	states := map[int]string{}
	activationErrors := map[int]string{}
	waiting, failures := 0, 0
	for _, contest := range contests {
		if settings.Mode == "off" || (settings.Mode == "selected" && !selected[contest.ID]) || !RunningPhase(contest.Phase) {
			continue
		}
		_, _, err := c.manager.ActivateRunning(ctx, contest.ID)
		if errors.Is(err, ErrCapacity) {
			states[contest.ID] = "waiting"
			waiting++
		} else if err != nil {
			states[contest.ID] = "error"
			activationErrors[contest.ID] = err.Error()
			failures++
		}
	}
	c.mu.Lock()
	c.states = states
	c.activationErrors = activationErrors
	c.waiting = waiting
	c.mu.Unlock()
	if c.observer != nil {
		c.observer.ObserveCollection(waiting, failures)
	}
}
func (c *Collector) Status() CollectionStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()
	status := CollectionStatus{Contests: []ContestCollection{}, DiscoveryUpdatedAt: c.updated, DiscoveryStale: c.updated.IsZero() || c.now().Sub(c.updated) >= time.Minute, LatestError: c.latestError, Waiting: c.waiting, Capacity: c.manager.config.MaxActiveContests}
	rows := map[int]ContestCollection{}
	for _, contest := range c.contests {
		if contest.Phase == "FINISHED" {
			continue
		}
		state := c.states[contest.ID]
		if state == "" {
			state = "idle"
		}
		rows[contest.ID] = ContestCollection{Contest: contest, CollectionState: state, LatestError: c.activationErrors[contest.ID]}
	}
	for _, session := range c.manager.Sessions() {
		contest := session.Contest()
		state, poll, err := session.CollectionStatus()
		rows[contest.ID] = ContestCollection{Contest: contest, CollectionState: state, LastSuccessfulPoll: poll, LatestError: err}
	}
	for _, row := range rows {
		status.Contests = append(status.Contests, row)
	}
	sort.Slice(status.Contests, func(i, j int) bool {
		a, b := status.Contests[i], status.Contests[j]
		if a.StartTimeSeconds != b.StartTimeSeconds {
			return a.StartTimeSeconds < b.StartTimeSeconds
		}
		return a.ID < b.ID
	})
	return status
}
