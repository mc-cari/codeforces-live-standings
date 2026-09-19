package httpapi

import (
	"bufio"
	"context"
	"encoding/base64"
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
	server := httptest.NewServer(NewServer(manager, Config{MaxHandles: 20}))
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
