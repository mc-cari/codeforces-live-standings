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

type selectedTeamCapture struct {
	Name        string            `json:"name"`
	Submissions []json.RawMessage `json:"submissions"`
}

type teamHistoryCapture struct {
	Contest              json.RawMessage                `json:"contest"`
	Problems             json.RawMessage                `json:"problems"`
	SelectedOfficialRows []json.RawMessage              `json:"selectedOfficialRows"`
	SelectedTeams        map[string]selectedTeamCapture `json:"selectedTeams"`
}

func TestCapturedTeamHistoryThroughProvidersAndSSE(t *testing.T) {
	binary := os.Getenv("LIVE_V3_TEST_BINARY")
	if binary == "" {
		t.Fatal("set LIVE_V3_TEST_BINARY to the real cds-converter executable")
	}
	for _, contestID := range []int{639, 640} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "reviews", "evidence", "live-v3-commit-review", "team-replay", fmt.Sprintf("contest-%d.json", contestID)))
		if err != nil {
			t.Fatal(err)
		}
		var captured teamHistoryCapture
		if err := json.Unmarshal(raw, &captured); err != nil {
			t.Fatal(err)
		}
		var contest domain.Contest
		if err := json.Unmarshal(captured.Contest, &contest); err != nil {
			t.Fatal(err)
		}
		for teamID, team := range captured.SelectedTeams {
			if team.Name == "TLE #98" {
				continue
			}
			if len(team.Submissions) == 0 {
				t.Fatalf("contest %d team %s has no captured submissions", contestID, teamID)
			}
			var first domain.Submission
			if err := json.Unmarshal(team.Submissions[0], &first); err != nil {
				t.Fatal(err)
			}
			party := first.Author
			teamIDValue := party.TeamID
			if teamIDValue == 0 {
				t.Fatalf("contest %d team %s lacks a team ID", contestID, teamID)
			}
			members := make([]string, 0, len(party.Members))
			for _, member := range party.Members {
				members = append(members, member.Handle)
			}
			if len(members) == 0 {
				t.Fatalf("contest %d team %s has no members", contestID, teamID)
			}
			selections := [][]string{members}
			if len(members) > 1 {
				selections = [][]string{{members[len(members)-1]}, members}
			}
			t.Run(fmt.Sprintf("contest-%d/team-%d", contestID, teamIDValue), func(t *testing.T) {
				for _, engine := range []string{"codeforces", "livev3"} {
					t.Run(engine, func(t *testing.T) {
						runTeamHistoryE2E(t, binary, engine, captured, contest, teamIDValue, team.Submissions, selections)
					})
				}
			})
		}
	}
}

func runTeamHistoryE2E(t *testing.T, binary, engine string, captured teamHistoryCapture, contest domain.Contest, selectedTeamID int, history []json.RawMessage, selections [][]string) {
	t.Helper()
	apiRows := make([]json.RawMessage, 0, len(captured.SelectedOfficialRows))
	var wantRow *domain.RanklistRow
	for _, rawRow := range captured.SelectedOfficialRows {
		apiRows = append(apiRows, rawRow)
		var row domain.RanklistRow
		if err := json.Unmarshal(rawRow, &row); err != nil {
			t.Fatal(err)
		}
		if row.Party.TeamID == selectedTeamID {
			copy := row
			wantRow = &copy
		}
	}
	if wantRow == nil {
		t.Fatalf("contest %d missing API row for team %d", contest.ID, selectedTeamID)
	}
	standingsEnvelope, err := json.Marshal(map[string]any{
		"status": "OK",
		"result": map[string]any{"contest": captured.Contest, "problems": captured.Problems, "rows": apiRows},
	})
	if err != nil {
		t.Fatal(err)
	}
	statusEnvelope, err := json.Marshal(map[string]any{"status": "OK", "result": history})
	if err != nil {
		t.Fatal(err)
	}
	hacksEnvelope := []byte(`{"status":"OK","result":[]}`)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("contestId") != fmt.Sprint(contest.ID) {
			http.Error(w, "unexpected contest", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/contest.standings":
			_, _ = w.Write(standingsEnvelope)
		case "/contest.status":
			_, _ = w.Write(statusEnvelope)
		case "/contest.hacks":
			_, _ = w.Write(hacksEnvelope)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	repository, err := sqlite.Open(filepath.Join(t.TempDir(), "team-history.sqlite"))
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
	manager := application.NewManager(store, gateway, application.Config{MaxActiveContests: 1, PollInterval: time.Hour, RetentionPeriod: time.Hour})
	defer manager.Stop()
	api := httptest.NewServer(httpapi.NewServer(manager, httpapi.Config{MaxStreams: 2}))
	defer api.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("%s/v1/contests/%d/activate", api.URL, contest.ID), nil)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("activation returned HTTP %d", response.StatusCode)
	}

	wantIDs := make(map[int]bool, len(history))
	for _, rawSubmission := range history {
		var submission domain.Submission
		if err := json.Unmarshal(rawSubmission, &submission); err != nil {
			t.Fatal(err)
		}
		wantIDs[submission.ID] = true
	}
	for _, handles := range selections {
		encoded := base64.RawURLEncoding.EncodeToString([]byte(strings.Join(handles, ";")))
		request, _ = http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/v1/contests/%d/events?h=%s", api.URL, contest.ID, encoded), nil)
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			t.Fatalf("SSE returned HTTP %d", response.StatusCode)
		}
		reader := bufio.NewScanner(response.Body)
		reader.Buffer(make([]byte, 4096), 4<<20)
		kind := ""
		gotSnapshot := false
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
				response.Body.Close()
				t.Fatal(err)
			}
			if len(snapshot.Submissions) != len(history) {
				continue
			}
			if len(snapshot.Standings.Rows) != 1 {
				response.Body.Close()
				t.Fatalf("selection %v returned %d team rows", handles, len(snapshot.Standings.Rows))
			}
			row := snapshot.Standings.Rows[0]
			if row.Party.TeamID != selectedTeamID || row.Points != wantRow.Points || row.Penalty != wantRow.Penalty || len(row.ProblemResults) != len(wantRow.ProblemResults) {
				response.Body.Close()
				t.Fatalf("selection %v returned mismatched team score: got %#v want %#v", handles, row, *wantRow)
			}
			for i, got := range row.ProblemResults {
				want := wantRow.ProblemResults[i]
				if got.Points != want.Points || got.RejectedAttemptCount != want.RejectedAttemptCount || got.Type != want.Type || got.BestSubmissionTimeSecs != want.BestSubmissionTimeSecs {
					response.Body.Close()
					problemIndex := "?"
					if i < len(snapshot.Standings.Problems) {
						problemIndex = snapshot.Standings.Problems[i].Index
					}
					t.Fatalf("selection %v problem %s (%d) differs: got %#v want %#v; all=%#v", handles, problemIndex, i, got, want, row.ProblemResults)
				}
			}
			gotIDs := make(map[int]bool, len(snapshot.Submissions))
			for _, submission := range snapshot.Submissions {
				gotIDs[submission.ID] = true
			}
			if !reflect.DeepEqual(gotIDs, wantIDs) {
				response.Body.Close()
				t.Fatalf("selection %v submission IDs differ: got %v want %v", handles, gotIDs, wantIDs)
			}
			gotSnapshot = true
			break
		}
		response.Body.Close()
		if err := reader.Err(); err != nil {
			t.Fatal(err)
		}
		if !gotSnapshot {
			t.Fatalf("selection %v did not produce a complete snapshot", handles)
		}
	}
}
