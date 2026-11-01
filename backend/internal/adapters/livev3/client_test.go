package livev3

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

func view(revision int64, ids ...int) *application.Snapshot {
	value := &application.Snapshot{Revision: revision, Contest: domain.Contest{ID: 1}, Health: application.Health{State: "live"}}
	value.Standings.Contest = value.Contest
	for _, id := range ids {
		value.Submissions = append(value.Submissions, domain.Submission{ID: id, Verdict: "TESTING"})
	}
	return value
}

func TestUpdatesRecoverMissingRevisionsAndRetiredSubmissions(t *testing.T) {
	previous := view(1, 1, 2)
	next := view(2, 1, 2)
	next.Submissions[1].Verdict = "OK"
	event := update(previous, next)
	if event.Kind != "patch" {
		t.Fatal(event.Kind)
	}
	patch := event.Payload.(application.Patch)
	if len(patch.SubmissionUpserts) != 1 || patch.SubmissionUpserts[0].Verdict != "OK" {
		t.Fatal(patch)
	}
	for _, next := range []*application.Snapshot{view(4, 1, 2), view(3, 2), view(0, 1)} {
		if event := update(view(2, 1, 2), next); event.Kind != "snapshot" {
			t.Fatal(event)
		}
	}
}

func TestSlowConsumerGetsReplacementSnapshot(t *testing.T) {
	events := make(chan application.Event, 2)
	events <- snapshotEvent(view(1, 1))
	events <- update(view(1, 1), view(2, 1, 2))
	current := view(3, 1, 2, 3)
	if !publish(context.Background(), events, update(view(2, 1, 2), current), current) {
		t.Fatal("publish failed")
	}
	event := <-events
	if event.Kind != "snapshot" || event.Revision != 3 || len(events) != 0 {
		t.Fatal(event)
	}
}

func TestDisconnectCancelsInternalRequest(t *testing.T) {
	var calls atomic.Int32
	canceled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			_ = json.NewEncoder(w).Encode(view(1, 1))
			return
		}
		<-r.Context().Done()
		close(canceled)
	}))
	defer server.Close()
	client, _ := NewClient(server.URL)
	feed, err := client.SubscribeContest(context.Background(), 1, []string{"alice"})
	if err != nil {
		t.Fatal(err)
	}
	<-feed.Events
	deadline := time.After(time.Second)
	for calls.Load() < 2 {
		select {
		case <-deadline:
			t.Fatal("poll never started")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	feed.Close()
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("request was not canceled")
	}
	select {
	case <-feed.Done:
	case <-time.After(time.Second):
		t.Fatal("feed did not stop")
	}
}

func TestUnavailableAndInvalidEngineResponses(t *testing.T) {
	for _, status := range []int{404, 409, 429, 502} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			client, _ := NewClient(server.URL)
			if _, err := client.ActivateContest(context.Background(), 1); err == nil {
				t.Fatal("expected error")
			}
		})
	}
	if _, err := NewClient("file:///tmp/engine"); err == nil {
		t.Fatal("expected invalid URL")
	}
}

func TestRecoveryReplacesStaleViewWithoutNewRevision(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch calls.Add(1) {
		case 1:
			_ = json.NewEncoder(w).Encode(view(1, 1))
		case 2:
			w.WriteHeader(http.StatusServiceUnavailable)
		case 3:
			if r.URL.Query().Get("after") != "" {
				t.Error("recovery must request a fresh view")
			}
			_ = json.NewEncoder(w).Encode(view(1, 1))
		default:
			<-r.Context().Done()
		}
	}))
	defer server.Close()
	client, _ := NewClient(server.URL)
	feed, err := client.SubscribeContest(context.Background(), 1, []string{"alice"})
	if err != nil {
		t.Fatal(err)
	}
	defer feed.Close()
	for _, expected := range []string{"live", "stale", "live"} {
		select {
		case event := <-feed.Events:
			value, ok := event.Payload.(application.Snapshot)
			if !ok || value.Health.State != expected || value.Revision != 1 {
				t.Fatalf("expected %s, got %#v", expected, event)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("missing %s view", expected)
		}
	}
}
