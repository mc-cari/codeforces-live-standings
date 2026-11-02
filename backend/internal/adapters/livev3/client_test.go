package livev3

import (
	"context"
	"encoding/json"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEntityUpsertReplayAndExplicitDeletion(t *testing.T) {
	entities := make(map[string]map[string][]byte)
	apply := func(data string) {
		var event feedEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			t.Fatal(err)
		}
		applyEvent(entities, event)
	}
	apply(`{"type":"submissions","id":"1","data":{"id":"1"},"x_live":{"custom_fields":{"codeforces.submission":"old"}}}`)
	before := string(entities["submissions"]["1"])
	apply(`{"type":"submissions","id":"1","data":{"id":"1"},"x_live":{"custom_fields":{"codeforces.submission":"old"}}}`)
	if string(entities["submissions"]["1"]) != before {
		t.Fatal("duplicate replay changed entity")
	}
	apply(`{"type":"submissions","id":"2","data":{"id":"2"}}`)
	if len(entities["submissions"]) != 2 {
		t.Fatal("omission removed entity")
	}
	apply(`{"type":"submissions","id":"1","data":{"id":"1"},"x_live":{"custom_fields":{"codeforces.submission":"new"}}}`)
	if string(entities["submissions"]["1"]) == before {
		t.Fatal("changed ID ignored")
	}
	apply(`{"type":"submissions","id":"1","data":null}`)
	if len(entities["submissions"]) != 1 {
		t.Fatal("explicit deletion ignored")
	}
}

func TestFreshTeamFeedReplacesPersistedLowercaseIdentityAfterStaging(t *testing.T) {
	published := map[string]map[string][]byte{
		"teams":       {"alice": []byte(`{"data":{"id":"alice"}}`)},
		"submissions": {"1": []byte(`{"data":{"id":"1"}}`)},
	}
	staged := stageFreshTeamEntities(published)
	if _, ok := published["teams"]["alice"]; !ok {
		t.Fatal("staging changed the published view before the new feed completed")
	}
	if len(staged["teams"]) != 0 || len(staged["submissions"]) != 1 {
		t.Fatalf("unexpected initial staged set: %#v", staged)
	}
	applyEvent(staged, feedEvent{Type: "teams", ID: "Alice", Data: json.RawMessage(`{"id":"Alice"}`), Live: extension{Fields: map[string]string{"codeforces.party": `{"members":[{"handle":"Alice"}]}`}}})
	if _, ok := staged["teams"]["alice"]; ok || len(staged["teams"]) != 1 {
		t.Fatalf("fresh team identity was not replaced cleanly: %#v", staged["teams"])
	}
	if _, ok := published["teams"]["alice"]; !ok {
		t.Fatal("published view was mutated while staging")
	}
}
func TestNormalizePreservesProgressAndEngineRows(t *testing.T) {
	entities := make(map[string]map[string][]byte)
	native := `{"contest":{"id":1,"phase":"CODING","type":"CF"},"problems":[{"index":"A"}]}`
	board := scoreboard{Live: extension{Fields: map[string]string{"codeforces.standings": native}}}
	var row boardRow
	row.Team = "alice"
	row.Rank = 4
	points := 430.0
	row.Score.Points = &points
	board.Rows = []boardRow{row}
	applyEvent(entities, feedEvent{Type: "teams", ID: "alice", Data: json.RawMessage(`{"id":"alice"}`), Live: extension{Fields: map[string]string{"codeforces.party": `{"members":[{"handle":"alice"}],"participantType":"OUT_OF_COMPETITION"}`}}})
	for _, count := range []int{22, 23} {
		submission := domain.Submission{ID: 1, Verdict: "TESTING", Testset: "TESTS", PassedTestCount: count, MemoryConsumedBytes: 1234, TimeConsumedMillis: 45, Author: domain.Party{Members: []domain.Member{{Handle: "alice"}}}}
		raw, _ := json.Marshal(submission)
		applyEvent(entities, feedEvent{Type: "submissions", ID: "1", Data: json.RawMessage(`{"id":"1"}`), Live: extension{Fields: map[string]string{"codeforces.submission": string(raw)}}})
		view, err := normalize(1, entities, board)
		if err != nil {
			t.Fatal(err)
		}
		if view.Submissions[1].PassedTestCount != count || view.Submissions[1].MemoryConsumedBytes != 1234 || view.Standings.Rows[0].Points != 430 || view.Standings.Rows[0].Rank != 4 {
			t.Fatal(view)
		}
	}
}

func TestNormalizeJoinsRestoredHandleSpellingExactly(t *testing.T) {
	entities := map[string]map[string][]byte{}
	applyEvent(entities, feedEvent{Type: "teams", ID: "ALICE", Data: json.RawMessage(`{"id":"ALICE"}`), Live: extension{Fields: map[string]string{"codeforces.party": `{"members":[{"handle":"ALICE"}],"participantType":"CONTESTANT"}`}}})
	var row boardRow
	row.Team = "ALICE"
	board := scoreboard{Rows: []boardRow{row}, Live: extension{Fields: map[string]string{"codeforces.standings": `{"contest":{"id":1,"phase":"CODING","type":"CF"},"problems":[]}`}}}
	view, err := normalize(1, entities, board)
	if err != nil || len(view.Standings.Rows) != 1 || view.Standings.Rows[0].Party.Members[0].Handle != "ALICE" {
		t.Fatalf("upper-case CLICS join failed: %#v %v", view, err)
	}
}

func TestReplayPublishesOnlyMatchingScoreboardAndRejectsFeedReset(t *testing.T) {
	for _, mismatch := range []bool{false, true} {
		t.Run(map[bool]string{false: "matching", true: "feed reset"}[mismatch], func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/scoreboard" {
					board := scoreboard{Live: extension{Instance: "new-worker", Watermark: "live-cds-2", Fields: map[string]string{"codeforces.standings": `{"contest":{"id":1,"phase":"CODING"},"problems":[]}`}}}
					_ = json.NewEncoder(w).Encode(board)
					return
				}
				w.Header().Set("Content-Type", "application/x-ndjson")
				w.WriteHeader(200)
				instance := "new-worker"
				if mismatch {
					instance = "old-worker"
				}
				for index, count := range []int{22, 23} {
					raw, _ := json.Marshal(domain.Submission{ID: 101, Verdict: "TESTING", PassedTestCount: count})
					_ = json.NewEncoder(w).Encode(feedEvent{Type: "submissions", ID: "101", Token: []string{"live-cds-1", "live-cds-2"}[index], Data: json.RawMessage(`{"id":"101"}`), Live: extension{Instance: instance, Fields: map[string]string{"codeforces.submission": string(raw)}}})
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer server.Close()
			client := &Client{}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			calls := 0
			err := client.consume(ctx, 1, server.URL, func(update application.ContestUpdate) {
				calls++
				if update.Submissions[101].PassedTestCount != 23 {
					t.Error("replay regression published")
				}
				cancel()
			})
			if err == nil {
				t.Fatal("expected cancellation or mismatch")
			}
			if mismatch && calls != 0 {
				t.Fatal("published mismatched instance")
			}
			if !mismatch && calls != 1 {
				t.Fatalf("published %d snapshots", calls)
			}
		})
	}
}
func TestWorkerCapacityAndReadinessFailureReleaseResources(t *testing.T) {
	client, err := New(Config{Binary: "/bin/false", MaxWorkers: 1, ReadyTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.get(1); err != nil {
		t.Fatal(err)
	}
	if _, err := client.get(2); err == nil {
		t.Fatal("worker capacity not enforced")
	}
	client.StopContest(1)
	if _, err := client.FetchStandings(context.Background(), 2); err == nil {
		t.Fatal("failed worker became ready")
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.workers) != 0 {
		t.Fatal("failed activation leaked worker")
	}
}

func TestContestStateRemainsAuthoritativeDuringFinalization(t *testing.T) {
	for _, test := range []struct {
		state    contestState
		phase    string
		finished bool
	}{
		{contestState{}, "BEFORE", false},
		{contestState{Started: "start"}, "SYSTEM_TEST", false},
		{contestState{Started: "start", Ended: "end"}, "FINISHED", true},
		{contestState{Started: "start", Finalized: "final"}, "FINISHED", true},
	} {
		board := scoreboard{State: &test.state, Live: extension{Fields: map[string]string{"codeforces.standings": `{"contest":{"id":1,"phase":"FINISHED"},"problems":[]}`}}}
		view, err := normalize(1, map[string]map[string][]byte{}, board)
		if err != nil || view.Standings.Contest.Phase != test.phase || view.Finished != test.finished {
			t.Fatal(view, err)
		}
	}
}
