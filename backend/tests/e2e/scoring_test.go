//go:build e2e

package e2e

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/codeforces"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/livev3"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
)

type fixture struct {
	ExpectedRows    []domain.RanklistRow
	ParticipantType string
	Standings       struct {
		Status string
		Result domain.Standings
	}
	Submissions struct {
		Status string
		Result []domain.Submission
	}
}

type score struct {
	ParticipantType string
	Handle          string
	Points          float64
	Penalty         int
	Problems        []float64
	FriendRank      int
}

func scores(rows []domain.RanklistRow) []score {
	result := make([]score, 0, len(rows))
	for _, row := range rows {
		item := score{ParticipantType: row.Party.ParticipantType, Handle: row.Party.Members[0].Handle, Points: row.Points, Penalty: row.Penalty, FriendRank: row.Party.Rank}
		for _, problem := range row.ProblemResults {
			item.Problems = append(item.Problems, problem.Points)
		}
		result = append(result, item)
	}
	return result
}

// Real API scores are the oracle; both providers must reach them through HTTP/SSE.
func TestSnapshotScoringAgreement(t *testing.T) {
	binary := os.Getenv("LIVE_V3_TEST_BINARY")
	if binary == "" {
		t.Fatal("set LIVE_V3_TEST_BINARY to the real cds-converter executable")
	}
	cases, err := filepath.Glob("fixtures/*.json")
	if err != nil {
		t.Fatal(err)
	}
	catalogRaw, err := os.ReadFile("contests.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog []domain.Contest
	if err := json.Unmarshal(catalogRaw, &catalog); err != nil {
		t.Fatal(err)
	}
	required := map[string]bool{}
	metadata := map[int]domain.Contest{}
	for _, contest := range catalog {
		required[fmt.Sprint(contest.ID)] = true
		metadata[contest.ID] = contest
	}
	for _, id := range []int{1735, 1739} {
		for _, kind := range []string{"unofficial", "virtual", "practice"} {
			required[fmt.Sprintf("%d-%s", id, kind)] = true
		}
	}
	for _, path := range cases {
		delete(required, strings.TrimSuffix(filepath.Base(path), ".json"))
	}
	if len(required) != 0 {
		t.Fatalf("missing required fixtures: %v", required)
	}
	if len(cases) != len(catalog)+6 {
		t.Fatalf("unexpected fixture count: %d", len(cases))
	}
	for _, path := range cases {
		name := strings.TrimSuffix(filepath.Base(path), ".json")
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var envelopes map[string]json.RawMessage
			if err := json.Unmarshal(raw, &envelopes); err != nil {
				t.Fatal(err)
			}
			var f fixture
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatal(err)
			}
			if f.Standings.Status != "OK" || f.Submissions.Status != "OK" || len(f.Standings.Result.Rows) == 0 || len(f.Submissions.Result) == 0 {
				t.Fatal("invalid fixture")
			}
			contest := f.Standings.Result.Contest
			id := contest.ID
			expectedMetadata, ok := metadata[id]
			if !ok || contest.Name != expectedMetadata.Name || contest.Type != expectedMetadata.Type || contest.DurationSeconds != expectedMetadata.DurationSeconds || contest.Phase != "FINISHED" {
				t.Fatal("fixture metadata differs from contest catalog")
			}
			if name != fmt.Sprint(id) && !strings.HasPrefix(name, fmt.Sprintf("%d-", id)) {
				t.Fatal("fixture filename differs from contest ID")
			}
			oracleRows := f.Standings.Result.Rows
			if f.ExpectedRows != nil {
				oracleRows = f.ExpectedRows
			}
			if f.ParticipantType != "" {
				found := false
				for _, row := range oracleRows {
					if row.Party.ParticipantType == f.ParticipantType {
						found = true
					}
				}
				if !found {
					t.Fatal("participant fixture is missing its declared type")
				}
			}
			handles := []string{}
			for _, row := range oracleRows {
				handles = append(handles, row.Party.Members[0].Handle)
			}
			expected := f.Standings.Result
			expected.Rows = append([]domain.RanklistRow(nil), oracleRows...)
			for i := range expected.Rows {
				expected.Rows[i].Party.Rank = i + 1
				if i > 0 && expected.Rows[i].Rank == expected.Rows[i-1].Rank {
					expected.Rows[i].Party.Rank = expected.Rows[i-1].Party.Rank
				}
			}
			wantSubmissions := map[int]domain.Submission{}
			wantIDs := map[int]bool{}
			for _, submission := range f.Submissions.Result {
				wantIDs[submission.ID] = true
				wantSubmissions[submission.ID] = submission
			}
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("contestId") != fmt.Sprint(id) {
					http.Error(w, "unexpected contest", 400)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/contest.standings":
					w.Write(envelopes["standings"])
				case "/contest.status":
					w.Write(envelopes["submissions"])
				case "/contest.hacks":
					fmt.Fprint(w, `{"status":"OK","result":[]}`)
				default:
					http.NotFound(w, r)
				}
			}))
			defer upstream.Close()
			results := map[string][]score{}
			for _, engine := range []string{"codeforces", "livev3"} {
				t.Run(engine, func(t *testing.T) {
					repository, err := sqlite.Open(filepath.Join(t.TempDir(), "standings.sqlite"))
					if err != nil {
						t.Fatal(err)
					}
					defer repository.Close()
					store, err := repository.Scope(engine)
					if err != nil {
						t.Fatal(err)
					}
					var gateway application.ContestGateway
					if engine == "codeforces" {
						gateway = codeforces.NewClient(upstream.URL+"/", &http.Client{Timeout: 5 * time.Second}, 0)
					} else {
						source, err := livev3.New(livev3.Config{Binary: binary, APIBaseURL: upstream.URL + "/", Store: store})
						if err != nil {
							t.Fatal(err)
						}
						gateway = source
					}
					manager := application.NewManager(store, gateway, application.Config{MaxActiveContests: 3, PollInterval: 50 * time.Millisecond, RetentionPeriod: time.Hour})
					api := httptest.NewServer(httpapi.NewServer(manager, httpapi.Config{MaxStreams: 2}))
					defer api.Close()
					defer manager.Stop()
					ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
					defer cancel()
					request, _ := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("%s/v1/contests/%d/activate", api.URL, id), nil)
					response, err := http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					response.Body.Close()
					if response.StatusCode != 200 {
						t.Fatalf("activation HTTP %d", response.StatusCode)
					}
					// Reverse and uppercase selection to exercise filtering and canonical ranking.
					selection := []string{}
					for i := len(handles) - 1; i >= 0; i-- {
						selection = append(selection, strings.ToUpper(handles[i]))
					}
					encoded := base64.RawURLEncoding.EncodeToString([]byte(strings.Join(selection, ";")))
					request, _ = http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/v1/contests/%d/events?h=%s", api.URL, id, encoded), nil)
					response, err = http.DefaultClient.Do(request)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					if response.StatusCode != 200 {
						t.Fatalf("stream HTTP %d", response.StatusCode)
					}
					reader := bufio.NewScanner(response.Body)
					reader.Buffer(make([]byte, 4096), 4<<20)
					kind := ""
					for reader.Scan() {
						line := reader.Text()
						if strings.HasPrefix(line, "event: ") {
							kind = strings.TrimPrefix(line, "event: ")
						}
						if kind != "snapshot" || !strings.HasPrefix(line, "data: ") {
							continue
						}
						var snapshot application.Snapshot
						if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &snapshot); err != nil {
							t.Fatal(err)
						}
						// Wait for ingestion using each engine's current eligibility rules,
						// then assert the same full oracle. Unsupported parties fail promptly.
						ingestedCount := 0
						for _, submission := range f.Submissions.Result {
							typ := submission.Author.ParticipantType
							if engine == "codeforces" || typ == "CONTESTANT" || typ == "OUT_OF_COMPETITION" {
								ingestedCount++
							}
						}
						if len(snapshot.Submissions) != ingestedCount && len(snapshot.Submissions) != len(f.Submissions.Result) {
							continue
						}
						seenIDs := map[int]bool{}
						for _, submission := range snapshot.Submissions {
							seenIDs[submission.ID] = true
							original, ok := wantSubmissions[submission.ID]
							if !ok || original.Verdict != submission.Verdict || original.Author.ParticipantType != submission.Author.ParticipantType {
								t.Errorf("submission %d lost its verdict or participant type", submission.ID)
							}
						}
						if !reflect.DeepEqual(seenIDs, wantIDs) {
							t.Errorf("submission history IDs differ from API snapshot: got %v, want %v", seenIDs, wantIDs)
						}
						got := scores(snapshot.Standings.Rows)
						if !reflect.DeepEqual(got, scores(expected.Rows)) {
							t.Fatalf("scores differ from Codeforces snapshot\ngot: %#v\nwant: %#v", got, scores(expected.Rows))
						}
						results[engine] = got
						return
					}
					t.Fatalf("no complete snapshot: %v", reader.Err())
				})
			}
			if len(results) == 2 && !reflect.DeepEqual(results["codeforces"], results["livev3"]) {
				t.Fatal("backend disagreement")
			}
		})
	}
}
