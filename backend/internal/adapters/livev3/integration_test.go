package livev3

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
)

func TestGoAPIWithLiveV3Engine(t *testing.T) {
	binary := os.Getenv("LIVE_V3_TEST_BINARY")
	if binary == "" {
		t.Skip("LIVE_V3_TEST_BINARY is not configured")
	}
	var stage atomic.Int32
	contest := domain.Contest{ID: 1, Name: "Integration", Type: "CF", Phase: "CODING", StartTimeSeconds: 1700000000, DurationSeconds: 7200}
	problem := domain.Problem{ContestID: 1, Index: "A", Name: "A", Type: "PROGRAMMING", Points: 500}
	submission := func(id, seconds int, verdict, handle string) domain.Submission {
		return domain.Submission{ID: id, ContestID: 1, RelativeTimeSeconds: int64(seconds), CreationTimeSeconds: 1700000000 + int64(seconds), Problem: problem, Author: domain.Party{Members: []domain.Member{{Handle: handle}}, ParticipantType: "CONTESTANT"}, Verdict: verdict, ProgrammingLanguage: "GNU C++17", Testset: "TESTS", PassedTestCount: 1}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var result any
		switch r.URL.Path {
		case "/contest.standings":
			result = domain.Standings{Contest: contest, Problems: []domain.Problem{problem, {ContestID: 1, Index: "B", Name: "B", Type: "PROGRAMMING", Points: 500}}, Rows: []domain.RanklistRow{}}
		case "/contest.hacks":
			result = []any{}
		case "/contest.status":
			if stage.Load() == 0 {
				unofficial := submission(301, 300, "OK", "charlie")
				unofficial.Author.ParticipantType = "OUT_OF_COMPETITION"
				result = []domain.Submission{submission(101, 300, "WRONG_ANSWER", "alice"), submission(102, 600, "OK", "alice"), submission(201, 300, "OK", "bob"), unofficial}
			} else {
				value := submission(103, 700, "OK", "alice")
				value.Problem.Index = "B"
				value.Problem.Name = "B"
				switch stage.Load() {
				case 2:
					value.Verdict = "TESTING"
					value.PassedTestCount = 22
				case 3:
					value.Verdict = "TESTING"
					value.PassedTestCount = 23
				case 5:
					value.Verdict = "WRONG_ANSWER"
				}
				result = []domain.Submission{value}
			}
		default:
			http.NotFound(w, r)
			return
		}
		if values, ok := result.([]domain.Submission); ok {
			raw, _ := json.Marshal(values)
			var submissions []map[string]any
			_ = json.Unmarshal(raw, &submissions)
			for _, item := range submissions {
				item["author"].(map[string]any)["ghost"] = false
			}
			result = submissions
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "OK", "result": result})
	}))
	defer upstream.Close()
	repository, err := sqlite.Open(t.TempDir() + "/live.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	store, err := repository.Scope("livev3")
	if err != nil {
		t.Fatal(err)
	}
	source, err := New(Config{Binary: binary, APIBaseURL: upstream.URL + "/", Store: store})
	if err != nil {
		t.Fatal(err)
	}
	manager := application.NewManager(store, source, application.Config{MaxActiveContests: 3, RetentionPeriod: time.Hour})
	defer manager.Stop()
	var provider application.LiveStandingsProvider = manager
	api := httptest.NewServer(httpapi.NewServer(provider, httpapi.Config{MaxStreams: 2}))
	t.Cleanup(api.Close)
	client := &http.Client{Timeout: 90 * time.Second}
	response, err := client.Post(api.URL+"/v1/contests/1/activate", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var activation application.Activation
	if response.StatusCode != 200 {
		t.Fatalf("activation HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(&activation); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if activation.Contest.ID != 1 {
		t.Fatal(activation)
	}
	connect := func(handles string) (*http.Response, *bufio.Reader) {
		response, err := client.Get(api.URL + "/v1/contests/1/events?h=" + handles)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 200 {
			response.Body.Close()
			t.Fatalf("stream HTTP %d", response.StatusCode)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response, bufio.NewReader(response.Body)
	}
	read := func(reader *bufio.Reader) (string, json.RawMessage) {
		kind := ""
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasPrefix(line, "event: ") {
				kind = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
			}
			if strings.HasPrefix(line, "data: ") {
				return kind, json.RawMessage(strings.TrimSpace(strings.TrimPrefix(line, "data: ")))
			}
		}
	}
	stream, reader := connect("YWxpY2U")
	kind, payload := read(reader)
	var initial application.Snapshot
	if err := json.Unmarshal(payload, &initial); err != nil {
		t.Fatal(err)
	}
	for len(initial.Submissions) != 2 {
		kind, payload = read(reader)
		if kind != "snapshot" {
			continue
		}
		if err := json.Unmarshal(payload, &initial); err != nil {
			t.Fatal(err)
		}
	}
	if initial.Standings.Rows[0].Points != 430 {
		t.Fatalf("initial %s: %s", kind, payload)
	}
	stage.Store(1)
	for {
		kind, payload = read(reader)
		if kind != "snapshot" {
			continue
		}
		var patch application.Snapshot
		if err := json.Unmarshal(payload, &patch); err != nil {
			t.Fatal(err)
		}
		if len(patch.Submissions) > 0 && patch.Submissions[0].ID == 103 {
			break
		}
	}
	defer stream.Body.Close()
	bob, bobReader := connect(base64.RawURLEncoding.EncodeToString([]byte("BOB;charlie")))
	_, payload = read(bobReader)
	if !bytes.Contains(payload, []byte(`"id":201`)) || bytes.Contains(payload, []byte(`"id":101`)) {
		t.Fatal(string(payload))
	}
	var tied application.Snapshot
	if err := json.Unmarshal(payload, &tied); err != nil {
		t.Fatal(err)
	}
	if len(tied.Standings.Rows) != 2 || tied.Standings.Rows[0].Rank != tied.Standings.Rows[1].Rank || len(tied.Submissions) != 2 || tied.Submissions[0].Author.Rank != 1 || tied.Submissions[1].Author.Rank != 1 {
		t.Fatalf("unofficial ties lost: %s", payload)
	}
	bob.Body.Close()
	source.mu.Lock()
	workers := len(source.workers)
	source.mu.Unlock()
	if workers != 1 {
		t.Fatalf("two browsers started %d workers", workers)
	}
	scores := make(map[int32]float64)
	for _, next := range []struct {
		stage   int32
		verdict string
		tests   int
	}{{2, "TESTING", 22}, {3, "TESTING", 23}, {4, "OK", 1}, {5, "WRONG_ANSWER", 1}, {6, "OK", 1}} {
		stage.Store(next.stage)
		for {
			kind, payload = read(reader)
			if kind != "snapshot" {
				continue
			}
			var current application.Snapshot
			if err := json.Unmarshal(payload, &current); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, submission := range current.Submissions {
				if submission.ID == 103 && submission.Verdict == next.verdict && submission.PassedTestCount == next.tests {
					found = true
				}
			}
			if found {
				scores[next.stage] = current.Standings.Rows[0].Points
				break
			}
		}
	}
	if scores[2] != scores[3] || scores[4] <= scores[3] || scores[5] >= scores[4] || scores[6] != scores[4] {
		t.Fatalf("score/rejudge transitions: %v", scores)
	}
	source.StopContest(1)
	// Session owns restart, keeps the previous published state stale, and merges
	// the fresh worker replay with retained entities from SQLite.
	staleSeen := false
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		kind, payload = read(reader)
		if kind == "state" && bytes.Contains(payload, []byte(`"state":"stale"`)) {
			staleSeen = true
		}
		if kind == "snapshot" && bytes.Contains(payload, []byte(`"id":101`)) && bytes.Contains(payload, []byte(`"id":103`)) && bytes.Contains(payload, []byte(`"state":"live"`)) {
			if !staleSeen {
				t.Fatal("worker restart did not mark retained view stale")
			}
			stream.Body.Close()
			manager.Stop()
			restoredSource, err := New(Config{Binary: binary, APIBaseURL: upstream.URL + "/", Store: store})
			if err != nil {
				t.Fatal(err)
			}
			restored := application.NewManager(store, restoredSource, application.Config{MaxActiveContests: 3, RetentionPeriod: time.Hour})
			defer restored.Stop()
			if err := restored.Restore(t.Context()); err != nil {
				t.Fatal(err)
			}
			feed, err := restored.SubscribeContest(t.Context(), 1, []string{"alice"})
			if err != nil {
				t.Fatal(err)
			}
			defer feed.Close()
			first := <-feed.Events
			saved := first.Payload.(application.Snapshot)
			if saved.Health.State != "stale" || len(saved.Submissions) != 3 {
				t.Fatalf("application restart lost retained view: %#v", saved)
			}
			return
		}
	}
	t.Fatal("worker did not reconcile retained history")
}
