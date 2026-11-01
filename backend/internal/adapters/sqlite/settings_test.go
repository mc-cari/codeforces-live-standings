package sqlite

import (
	"context"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"path/filepath"
	"testing"
	"time"
)

type recoveryGateway struct{}

func (recoveryGateway) FetchContests(context.Context) ([]domain.Contest, error) {
	return []domain.Contest{{ID: 42, Phase: "CODING"}}, nil
}
func (recoveryGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return []domain.Submission{{ID: 7, ContestID: 42, Author: domain.Party{Members: []domain.Member{{Handle: "tourist"}}}}}, nil
}
func (recoveryGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	return domain.Standings{Contest: domain.Contest{ID: 42, Phase: "CODING"}}, nil
}
func TestSettingsPersistenceAndZeroViewerRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "live.sqlite")
	r, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	s, err := r.LoadCollectionSettings()
	if err != nil || s.Mode != "off" {
		t.Fatal("default must be Off", err)
	}
	if err := r.SaveCollectionSettings(application.CollectionSettings{Mode: "selected", SelectedContestIDs: []int{42}}); err != nil {
		t.Fatal(err)
	}
	r.Close()
	r, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	s, err = r.LoadCollectionSettings()
	if err != nil || s.Mode != "selected" || len(s.SelectedContestIDs) != 1 {
		t.Fatal("settings not persisted", s, err)
	}
	manager := application.NewManager(r, recoveryGateway{}, application.Config{PollInterval: time.Hour, MaxActiveContests: 3})
	collector, err := application.NewCollector(r, recoveryGateway{}, manager, nil)
	if err != nil {
		t.Fatal(err)
	}
	collector.Refresh(context.Background())
	session := manager.Get(42)
	if session == nil {
		t.Fatal("automatic collection did not activate selected contest")
	}
	deadline := time.Now().Add(time.Second)
	for {
		_, poll, _ := session.CollectionStatus()
		if !poll.IsZero() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("zero viewer polling did not complete")
		}
		time.Sleep(time.Millisecond)
	}
	manager.Stop()
	<-session.Stopped()
	if err := r.SaveCollectionSettings(application.DefaultCollectionSettings()); err != nil {
		t.Fatal(err)
	}
	r.Close()
	r, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	restored := application.NewManager(r, recoveryGateway{}, application.Config{PollInterval: time.Hour, MaxActiveContests: 3})
	if err := restored.Restore(context.Background()); err != nil {
		t.Fatal(err)
	}
	resumed := restored.Get(42)
	if resumed == nil {
		t.Fatal("Off prevented session recovery")
	}
	defer func() { restored.Stop(); <-resumed.Stopped() }()
	sub := resumed.Subscribe([]string{"tourist"})
	defer resumed.Unsubscribe(sub)
	deadline = time.Now().Add(time.Second)
	for {
		select {
		case event := <-sub.Events:
			var submissions []domain.Submission
			if snapshot, ok := event.Payload.(application.Snapshot); ok {
				submissions = snapshot.Submissions
			}
			if patch, ok := event.Payload.(application.Patch); ok {
				submissions = patch.SubmissionUpserts
			}
			if len(submissions) == 1 && submissions[0].ID == 7 {
				return
			}
		case <-time.After(time.Until(deadline)):
			t.Fatal("late subscriber did not receive retained history")
		}
	}
}
