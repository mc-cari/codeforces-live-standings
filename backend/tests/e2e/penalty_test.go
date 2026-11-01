//go:build e2e

package e2e

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/codeforces"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/livev3"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
)

func TestICPCPenaltyRetention(t *testing.T) {
	binary := os.Getenv("LIVE_V3_TEST_BINARY")
	if binary == "" {
		t.Fatal("set LIVE_V3_TEST_BINARY to the real cds-converter executable")
	}
	raw, err := os.ReadFile("scenarios/icpc-penalty.json")
	if err != nil {
		t.Fatal(err)
	}
	var scenario struct {
		Stages []struct {
			Standings       json.RawMessage
			Submissions     json.RawMessage
			ExpectedPenalty int
		}
	}
	if err := json.Unmarshal(raw, &scenario); err != nil {
		t.Fatal(err)
	}
	if len(scenario.Stages) != 3 {
		t.Fatal("expected three penalty stages")
	}
	for _, override := range []bool{false, true} {
		t.Run(fmt.Sprintf("override=%v", override), func(t *testing.T) {
			for _, engine := range []string{"codeforces", "livev3"} {
				t.Run(engine, func(t *testing.T) {
					var stage atomic.Int32
					upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						w.Header().Set("Content-Type", "application/json")
						current := scenario.Stages[stage.Load()]
						switch r.URL.Path {
						case "/contest.standings":
							w.Write(current.Standings)
						case "/contest.status":
							w.Write(current.Submissions)
						case "/contest.hacks":
							fmt.Fprint(w, `{"status":"OK","result":[]}`)
						default:
							http.NotFound(w, r)
						}
					}))
					defer upstream.Close()
					repository, err := sqlite.Open(filepath.Join(t.TempDir(), "penalty.sqlite"))
					if err != nil {
						t.Fatal(err)
					}
					defer repository.Close()
					store, err := repository.Scope(engine)
					if err != nil {
						t.Fatal(err)
					}
					overrides := map[int]int{}
					if override {
						overrides[100001] = 5
					}
					var gateway application.ContestGateway
					if engine == "codeforces" {
						gateway = codeforces.NewClient(upstream.URL+"/", &http.Client{Timeout: time.Second * 5}, 0, codeforces.WithPenaltyOverrides(overrides))
					} else {
						source, err := livev3.New(livev3.Config{Binary: binary, APIBaseURL: upstream.URL + "/", Store: store, ICPCPenaltyOverrides: overrides})
						if err != nil {
							t.Fatal(err)
						}
						gateway = source
					}
					manager := application.NewManager(store, gateway, application.Config{MaxActiveContests: 3, PollInterval: time.Millisecond * 50, RetentionPeriod: time.Hour})
					api := httptest.NewServer(httpapi.NewServer(manager, httpapi.Config{MaxStreams: 2}))
					defer api.Close()
					defer manager.Stop()
					ctx, cancel := context.WithTimeout(t.Context(), time.Second*60)
					defer cancel()
					request, _ := http.NewRequestWithContext(ctx, "POST", api.URL+"/v1/contests/100001/activate", nil)
					response, err := http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					response.Body.Close()
					if response.StatusCode != 200 {
						t.Fatalf("activation HTTP %d", response.StatusCode)
					}
					// Only the unofficial guest is selected; inference needs the unfiltered official row.
					request, _ = http.NewRequestWithContext(ctx, "GET", api.URL+"/v1/contests/100001/events?h=Z3Vlc3Q", nil)
					response, err = http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					if response.StatusCode != 200 {
						t.Fatalf("stream HTTP %d", response.StatusCode)
					}
					reader := bufio.NewScanner(response.Body)
					for next, step := range scenario.Stages {
						stage.Store(int32(next))
						found := false
						for reader.Scan() {
							line := reader.Text()
							if !strings.HasPrefix(line, "data: ") {
								continue
							}
							var snapshot application.Snapshot
							if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &snapshot); err != nil {
								t.Fatal(err)
							}
							rows := snapshot.Standings.Rows
							if len(rows) != 1 || rows[0].Points != float64(next+1) {
								continue
							}
							expected := step.ExpectedPenalty
							if override {
								expected -= 2
							}
							if rows[0].Party.ParticipantType != "OUT_OF_COMPETITION" || rows[0].Penalty != expected {
								t.Fatalf("stage %d: expected guest penalty %d, got %#v", next, expected, rows)
							}
							found = true
							break
						}
						if !found {
							t.Fatalf("stage %d: no scored event: %v", next, reader.Err())
						}
					}
					if engine == "codeforces" {
						saved, err := store.LoadView(100001)
						if err != nil {
							t.Fatal(err)
						}
						expected := 7
						if override {
							expected = 5
						}
						if saved == nil || saved.Standings.ICPCPenaltyRule == nil || saved.Standings.ICPCPenaltyRule.Minutes != expected {
							t.Fatal("penalty rule not persisted")
						}
						response.Body.Close()
						manager.Stop()
						// Reactivation must prefer the persisted rule over conflicting API evidence.
						restored := application.NewManager(store, gateway, application.Config{MaxActiveContests: 3, PollInterval: time.Hour, RetentionPeriod: time.Hour})
						defer restored.Stop()
						if _, err := restored.ActivateContest(ctx, 100001); err != nil {
							t.Fatal(err)
						}
						feed, err := restored.SubscribeContest(ctx, 100001, []string{"guest"})
						if err != nil {
							t.Fatal(err)
						}
						defer feed.Close()
						event := <-feed.Events
						snapshot := event.Payload.(application.Snapshot)
						if snapshot.Standings.ICPCPenaltyRule == nil || snapshot.Standings.ICPCPenaltyRule.Minutes != expected || len(snapshot.Standings.Rows) != 1 || snapshot.Standings.Rows[0].Penalty != scenario.Stages[2].ExpectedPenalty-(7-expected) {
							t.Fatal("reactivation lost the saved penalty rule", snapshot.Standings)
						}

					}
				})
			}
		})
	}
}
