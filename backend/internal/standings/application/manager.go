package application

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

type Config struct {
	PollInterval      time.Duration
	RetentionPeriod   time.Duration
	MaxActiveContests int
}

type Manager struct {
	repository Repository
	gateway    ContestGateway
	config     Config
	mu         sync.Mutex
	sessions   map[int]*Session
	activating int
}

func NewManager(repository Repository, gateway ContestGateway, config Config) *Manager {
	return &Manager{repository: repository, gateway: gateway, config: config, sessions: make(map[int]*Session)}
}

func (manager *Manager) Restore(ctx context.Context) error {
	records, err := manager.repository.LoadActive()
	if err != nil {
		return err
	}
	for _, record := range records {
		stored, err := manager.repository.LoadSubmissions(record.Contest.ID)
		if err != nil {
			return err
		}
		session := newSession(manager.repository, manager.gateway, manager.config.PollInterval, record.Contest, nil, record.Revision, stored)
		manager.sessions[record.Contest.ID] = session
		go session.Run(ctx)
	}
	return nil
}

func (manager *Manager) Activate(ctx context.Context, id int) (*Session, bool, error) {
	manager.mu.Lock()
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
	manager.mu.Unlock()
	defer func() {
		manager.mu.Lock()
		manager.activating--
		manager.mu.Unlock()
	}()

	standings, err := manager.gateway.FetchStandings(ctx, id)
	if err != nil {
		return nil, false, err
	}
	if standings.Contest.Phase != "BEFORE" && standings.Contest.Phase != "CODING" {
		return nil, false, fmt.Errorf("contest is %s", standings.Contest.Phase)
	}
	if err := manager.repository.SaveContest(standings.Contest, time.Now()); err != nil {
		return nil, false, err
	}
	stored, err := manager.repository.LoadSubmissions(id)
	if err != nil {
		return nil, false, err
	}
	session := newSession(manager.repository, manager.gateway, manager.config.PollInterval, standings.Contest, &standings, 0, stored)
	manager.mu.Lock()
	if existing := manager.sessions[id]; existing != nil {
		manager.mu.Unlock()
		return existing, false, nil
	}
	manager.sessions[id] = session
	manager.mu.Unlock()
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
