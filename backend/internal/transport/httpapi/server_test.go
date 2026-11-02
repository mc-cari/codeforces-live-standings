package httpapi

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/telemetry"
)

type stagedGateway struct {
	mu                 sync.Mutex
	standings          domain.Standings
	oldSubmission      domain.Submission
	newSubmission      domain.Submission
	statusCalls        int
	firstStatusStarted chan struct{}
	releaseFirstStatus chan struct{}
	secondStatus       chan struct{}
}

type teamGateway struct {
	standings   domain.Standings
	submissions []domain.Submission
}

func (gateway teamGateway) InitialUpdate(context.Context, int) (application.ContestUpdate, error) {
	all := make(map[int]domain.Submission, len(gateway.submissions))
	for _, submission := range gateway.submissions {
		all[submission.ID] = submission
	}
	return application.ContestUpdate{Standings: gateway.standings, Submissions: all}, nil
}

func (gateway teamGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	return gateway.standings, nil
}
func (gateway teamGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return gateway.submissions, nil
}

func (gateway *stagedGateway) FetchStandings(_ context.Context, _ int) (domain.Standings, error) {
	return gateway.standings, nil
}

func (gateway *stagedGateway) FetchSubmissions(_ context.Context, _ int) ([]domain.Submission, error) {
	gateway.mu.Lock()
	gateway.statusCalls++
	call := gateway.statusCalls
	gateway.mu.Unlock()
	if call == 1 {
		close(gateway.firstStatusStarted)
		<-gateway.releaseFirstStatus
		return []domain.Submission{gateway.oldSubmission}, nil
	}
	select {
	case <-gateway.secondStatus:
	default:
		close(gateway.secondStatus)
	}
	return []domain.Submission{gateway.newSubmission}, nil
}

func TestLateSubscriberGetsReconciledSubmissionHistory(t *testing.T) {
	contest := domain.Contest{ID: 9001, Name: "Integration contest", Type: "CF", Phase: "CODING", DurationSeconds: 7200}
	oldSubmission := domain.Submission{
		ID: 101, ContestID: contest.ID, RelativeTimeSeconds: 30, Verdict: "OK",
		Problem: domain.Problem{ContestID: contest.ID, Index: "A", Name: "A", Type: "PROGRAMMING", Points: 500},
		Author:  domain.Party{ContestID: contest.ID, ParticipantType: "CONTESTANT", Members: []domain.Member{{Handle: "alpha"}}},
	}
	newSubmission := oldSubmission
	newSubmission.ID = 102
	newSubmission.RelativeTimeSeconds = 45
	newSubmission.Verdict = "WRONG_ANSWER"
	gateway := &stagedGateway{
		standings:          domain.Standings{Contest: contest, Problems: []domain.Problem{{ContestID: contest.ID, Index: "A", Name: "A", Type: "PROGRAMMING", Points: 500}}},
		oldSubmission:      oldSubmission,
		newSubmission:      newSubmission,
		firstStatusStarted: make(chan struct{}),
		releaseFirstStatus: make(chan struct{}),
		secondStatus:       make(chan struct{}),
	}
	repository, err := sqlite.Open(filepath.Join(t.TempDir(), "live.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	manager := application.NewManager(repository, gateway, application.Config{
		PollInterval:      20 * time.Millisecond,
		RetentionPeriod:   time.Hour,
		MaxActiveContests: 3,
	})
	metrics := telemetry.New(repository)
	server := httptest.NewServer(NewServer(manager, Config{MaxHandles: 20, Metrics: metrics, TelemetryToken: "test-token"}))
	defer server.Close()
	t.Cleanup(manager.Stop)

	activation, err := http.Post(server.URL+"/v1/contests/9001/activate", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	if activation.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(activation.Body)
		t.Fatalf("activation status=%d body=%s", activation.StatusCode, body)
	}
	activation.Body.Close()
	select {
	case <-gateway.firstStatusStarted:
	case <-time.After(time.Second):
		t.Fatal("worker did not start first submissions poll")
	}

	handles := base64.RawURLEncoding.EncodeToString([]byte("alpha"))
	firstResponse, err := http.Get(server.URL + "/v1/contests/9001/events?h=" + handles)
	if err != nil {
		t.Fatal(err)
	}
	firstReader := bufio.NewReader(firstResponse.Body)
	firstEvent := readEvent(t, firstReader)
	if firstEvent["event"] != "snapshot" || strings.Contains(firstEvent["data"], `"id":101`) {
		t.Fatalf("unexpected initial snapshot: %#v", firstEvent)
	}
	metricResponse := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(metricResponse, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(metricResponse.Body.String(), "cf_backend_sse_connections 1") {
		t.Fatal(metricResponse.Body.String())
	}
	publicMetrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	publicMetrics.Body.Close()
	if publicMetrics.StatusCode != 404 {
		t.Fatal("metrics exposed on application listener")
	}
	close(gateway.releaseFirstStatus)
	patchEvent := readEvent(t, firstReader)
	if patchEvent["event"] != "patch" || !strings.Contains(patchEvent["data"], `"id":101`) {
		t.Fatalf("expected first submission patch: %#v", patchEvent)
	}
	firstResponse.Body.Close()

	select {
	case <-gateway.secondStatus:
	case <-time.After(time.Second):
		t.Fatal("worker did not perform second submissions poll")
	}

	deadline := time.Now().Add(time.Second)
	for {
		lateResponse, err := http.Get(server.URL + "/v1/contests/9001/events?h=" + handles)
		if err != nil {
			t.Fatal(err)
		}
		lateEvent := readEvent(t, bufio.NewReader(lateResponse.Body))
		lateResponse.Body.Close()
		if lateEvent["event"] == "snapshot" && strings.Contains(lateEvent["data"], `"id":101`) && strings.Contains(lateEvent["data"], `"id":102`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("late snapshot lost reconciled submissions: %#v", lateEvent)
		}
		time.Sleep(10 * time.Millisecond)
	}
	deadline = time.Now().Add(time.Second)
	for {
		response := httptest.NewRecorder()
		metrics.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/metrics", nil))
		if strings.Contains(response.Body.String(), "cf_backend_sse_connections 0") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("SSE gauge did not return to zero")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTeamMemberSelectionOverSSEReturnsOneTeamAndNoDuplicateRuns(t *testing.T) {
	contest := domain.Contest{ID: 9100, Name: "team replay", Type: "ICPC", Phase: "CODING", DurationSeconds: 7200}
	team := domain.Party{ContestID: contest.ID, TeamID: 77, TeamName: "pair", ParticipantType: "CONTESTANT", Members: []domain.Member{{Handle: "Alpha"}, {Handle: "Beta"}}}
	problem := domain.Problem{ContestID: contest.ID, Index: "A", Name: "A", Type: "PROGRAMMING"}
	standings := domain.Standings{Contest: contest, Problems: []domain.Problem{problem}, Rows: []domain.RanklistRow{{Party: team, Rank: 1, Points: 1, ProblemResults: []domain.ProblemResult{{Points: 1, Type: "FINAL", BestSubmissionTimeSecs: 300}}}}}
	source := teamGateway{standings: standings, submissions: []domain.Submission{
		{ID: 1, ContestID: contest.ID, RelativeTimeSeconds: 100, Verdict: "WRONG_ANSWER", Problem: problem, Author: team},
		{ID: 2, ContestID: contest.ID, RelativeTimeSeconds: 300, Verdict: "OK", Problem: problem, Author: team},
	}}
	repository, err := sqlite.Open(filepath.Join(t.TempDir(), "team.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	manager := application.NewManager(repository, source, application.Config{PollInterval: time.Hour, RetentionPeriod: time.Hour, MaxActiveContests: 1})
	defer manager.Stop()
	server := httptest.NewServer(NewServer(manager, Config{MaxHandles: 20}))
	defer server.Close()
	response, err := http.Post(server.URL+"/v1/contests/9100/activate", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("activation status %d", response.StatusCode)
	}
	for _, selected := range [][]string{{"beta"}, {"Alpha", "BETA"}} {
		handles := base64.RawURLEncoding.EncodeToString([]byte(strings.Join(selected, ";")))
		feed, err := http.Get(server.URL + "/v1/contests/9100/events?h=" + handles)
		if err != nil {
			t.Fatal(err)
		}
		event := readEvent(t, bufio.NewReader(feed.Body))
		feed.Body.Close()
		if event["event"] != "snapshot" {
			t.Fatalf("expected snapshot: %#v", event)
		}
		var payload struct {
			Standings   domain.Standings    `json:"standings"`
			Submissions []domain.Submission `json:"submissions"`
		}
		if err := json.Unmarshal([]byte(event["data"]), &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Standings.Rows) != 1 || len(payload.Submissions) != 2 || payload.Submissions[0].ID == payload.Submissions[1].ID {
			t.Fatalf("handles %v returned %d rows and submissions %#v", selected, len(payload.Standings.Rows), payload.Submissions)
		}
	}
}

func readEvent(t *testing.T, reader *bufio.Reader) map[string]string {
	t.Helper()
	result := make(map[string]string)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read SSE event: %v", err)
		}
		line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")
		if line == "" {
			if len(result) > 0 {
				return result
			}
			continue
		}
		if strings.HasPrefix(line, "event: ") {
			result["event"] = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			result["data"] += strings.TrimPrefix(line, "data: ")
		}
	}
}

var _ application.ContestGateway = (*stagedGateway)(nil)
