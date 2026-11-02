package application

import (
	"context"
	"errors"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

var ErrContestInactive = errors.New("contest is not activated")

type Activation struct {
	State   string         `json:"state"`
	Contest domain.Contest `json:"contest"`
}

type Feed struct {
	Events <-chan Event
	Done   <-chan struct{}
	Close  func()
}

type LiveStandingsProvider interface {
	ActivateContest(context.Context, int) (Activation, error)
	SubscribeContest(context.Context, int, []string) (*Feed, error)
}

func (manager *Manager) ActivateContest(ctx context.Context, id int) (Activation, error) {
	session, _, err := manager.Activate(ctx, id)
	if err != nil {
		return Activation{}, err
	}
	state := "live"
	if finished, _ := session.Status(); finished {
		state = "finished"
	}
	return Activation{State: state, Contest: session.Contest()}, nil
}

func (manager *Manager) SubscribeContest(ctx context.Context, id int, handles []string) (*Feed, error) {
	session := manager.Get(id)
	if session == nil {
		return nil, ErrContestInactive
	}
	subscription := session.Subscribe(handles)
	return &Feed{Events: subscription.Events, Done: subscription.Done, Close: func() { session.Unsubscribe(subscription) }}, nil
}
