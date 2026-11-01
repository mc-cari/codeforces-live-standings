package livev3

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
)

func TestGoAPIWithLiveV3Engine(t *testing.T) {
	binary := os.Getenv("LIVE_V3_TEST_BINARY")
	if binary == "" {
		t.Skip("LIVE_V3_TEST_BINARY is not configured")
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	var stage atomic.Int32
	var failing atomic.Bool
	contest := domain.Contest{ID: 1, Name: "Integration", Type: "CF", Phase: "CODING", StartTimeSeconds: 1700000000, DurationSeconds: 7200}
	problem := domain.Problem{ContestID: 1, Index: "A", Name: "A", Type: "PROGRAMMING", Points: 500}
	submission := func(id, seconds int, verdict, handle string) domain.Submission {
		return domain.Submission{ID: id, ContestID: 1, RelativeTimeSeconds: int64(seconds), CreationTimeSeconds: 1700000000 + int64(seconds), Problem: problem, Author: domain.Party{Members: []domain.Member{{Handle: handle}}, ParticipantType: "CONTESTANT"}, Verdict: verdict, ProgrammingLanguage: "GNU C++17", Testset: "TESTS", PassedTestCount: 1}
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var result any
		switch r.URL.Path {
		case "/contest.standings":
			result = domain.Standings{Contest: contest, Problems: []domain.Problem{problem}, Rows: []domain.RanklistRow{}}
		case "/contest.hacks":
			result = []any{}
		case "/contest.status":
			if stage.Load() == 0 {
				result = []domain.Submission{submission(101, 300, "WRONG_ANSWER", "alice"), submission(102, 600, "OK", "alice"), submission(201, 300, "OK", "bob")}
			} else {
				result = []domain.Submission{submission(103, 700, "OK", "alice")}
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
		if failing.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("upstream unavailable"))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "OK", "result": result})
	}))
	defer upstream.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	data := t.TempDir()
	start := func() *exec.Cmd {
		log, err := os.CreateTemp(t.TempDir(), "engine-*.log")
		if err != nil {
			t.Fatal(err)
		}
		command := exec.Command(binary)
		command.Env = append(os.Environ(), "DATA_DIR="+data, "LISTEN_ADDR="+address, "METRICS_LISTEN_ADDR=127.0.0.1:0", "CF_API_BASE_URL="+upstream.URL+"/", "POLL_INTERVAL_MS=100", "CF_REQUEST_INTERVAL_MS=20")
		command.Stdout, command.Stderr = log, log
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if t.Failed() {
				contents, _ := os.ReadFile(log.Name())
				t.Logf("engine log: %s", contents)
			}
			if command.ProcessState == nil {
				_ = command.Process.Kill()
				_ = command.Wait()
			}
			log.Close()
		})
		deadline := time.Now().Add(30 * time.Second)
		for time.Now().Before(deadline) {
			response, err := http.Get("http://" + address + "/healthz")
			if err == nil {
				response.Body.Close()
				if response.StatusCode == 200 {
					return command
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		contents, _ := os.ReadFile(log.Name())
		t.Fatalf("engine did not start: %s", contents)
		return nil
	}
	engine := start()
	provider, _ := NewClient("http://" + address)
	api := httptest.NewServer(httpapi.NewServer(provider, httpapi.Config{MaxStreams: 2}))
	t.Cleanup(api.Close)
	client := &http.Client{Timeout: 20 * time.Second}
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
	if kind != "snapshot" || len(initial.Submissions) != 2 || initial.Standings.Rows[0].Points != 430 {
		t.Fatalf("initial %s: %s", kind, payload)
	}
	failing.Store(true)
	staleDeadline := time.After(10 * time.Second)
	staleSeen := false
	for !staleSeen {
		select {
		case <-staleDeadline:
			t.Fatal("stale state not published")
		default:
			kind, payload = read(reader)
			if kind == "snapshot" {
				var current application.Snapshot
				if err := json.Unmarshal(payload, &current); err != nil {
					t.Fatal(err)
				}
				staleSeen = current.Health.State == "stale" && len(current.Submissions) == 2
			}
		}
	}
	failing.Store(false)
	stage.Store(1)
	for {
		kind, payload = read(reader)
		if kind != "patch" {
			continue
		}
		var patch application.Patch
		if err := json.Unmarshal(payload, &patch); err != nil {
			t.Fatal(err)
		}
		if len(patch.SubmissionUpserts) > 0 && patch.SubmissionUpserts[0].ID == 103 {
			break
		}
	}
	stream.Body.Close()
	bob, bobReader := connect("Qk9C")
	_, payload = read(bobReader)
	if !bytes.Contains(payload, []byte(`"id":201`)) || bytes.Contains(payload, []byte(`"id":101`)) {
		t.Fatal(string(payload))
	}
	bob.Body.Close()
	_ = engine.Process.Signal(os.Interrupt)
	if err := engine.Wait(); err != nil && !strings.Contains(err.Error(), "exit status 130") {
		t.Log(fmt.Sprint(err))
	}
	start()
	reconnected, reconnectedReader := connect("YWxpY2U")
	defer reconnected.Body.Close()
	kind, payload = read(reconnectedReader)
	if kind != "snapshot" || !bytes.Contains(payload, []byte(`"id":101`)) || !bytes.Contains(payload, []byte(`"id":103`)) {
		t.Fatalf("restored %s: %s", kind, payload)
	}
}
