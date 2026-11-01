package application

import (
	"context"
	"errors"
	"fmt"
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

var ErrCapacity = errors.New("active contest capacity reached")

type Manager struct {
	activationMu sync.Mutex
	runContext   context.Context
	repository   Repository
	gateway      ContestGateway
	config       Config
	mu           sync.Mutex
	sessions     map[int]*Session
}

func NewManager(repository Repository, gateway ContestGateway, config Config) *Manager {
	return &Manager{runContext: context.Background(), repository: repository, gateway: gateway, config: config, sessions: make(map[int]*Session)}
}

func (manager *Manager) Restore(ctx context.Context) error {
	manager.runContext = ctx
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
		manager.sessions[record.Contest.ID] = session
		go session.Run(ctx)
	}
	return nil
}

func (manager *Manager) Activate(ctx context.Context, id int) (*Session, bool, error) {
	return manager.activate(ctx, id, false)
}

// ActivateRunning rechecks eligibility against fresh standings before persisting.
func (manager *Manager) ActivateRunning(ctx context.Context, id int) (*Session, bool, error) {
	return manager.activate(ctx, id, true)
}

func (manager *Manager) activate(ctx context.Context, id int, runningOnly bool) (*Session, bool, error) {
	// Serialize creation before any upstream or persistence work. Viewers and
	// automatic collection must share one activation and one capacity decision.
	manager.activationMu.Lock()
	defer manager.activationMu.Unlock()
	manager.mu.Lock()
	if session := manager.sessions[id]; session != nil {
		manager.mu.Unlock()
		return session, false, nil
	}
	active := 0
	for _, session := range manager.sessions {
		finished, _ := session.Status()
		if !finished {
			active++
		}
	}
	if active >= manager.config.MaxActiveContests {
		manager.mu.Unlock()
		return nil, false, ErrCapacity
	}
	manager.mu.Unlock()

	standings, err := manager.gateway.FetchStandings(ctx, id)
	if err != nil {
		return nil, false, err
	}
	finished := strings.EqualFold(standings.Contest.Phase, "FINISHED")
	if (runningOnly && !RunningPhase(standings.Contest.Phase)) || (!runningOnly && standings.Contest.Phase != "BEFORE" && !RunningPhase(standings.Contest.Phase) && !finished) {
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
	session := newSession(manager.repository, manager.gateway, manager.config.PollInterval, standings.Contest, &standings, 0, stored, manager.config.SubmissionHistoryObserver)
	manager.mu.Lock()
	manager.sessions[id] = session
	manager.mu.Unlock()
	go session.Run(manager.runContext)
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
	sessions := make([]*Session, 0, len(manager.sessions))
	for _, session := range manager.sessions {
		sessions = append(sessions, session)
	}
	manager.mu.Unlock()
	for _, session := range sessions {
		session.Stop()
	}
}

func RunningPhase(phase string) bool {
	switch phase {
	case "CODING", "PENDING_SYSTEM_TEST", "SYSTEM_TEST":
		return true
	}
	return false
}

func (manager *Manager) Sessions() []*Session {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	result := make([]*Session, 0, len(manager.sessions))
	for _, session := range manager.sessions {
		result = append(result, session)
	}
	return result
}
