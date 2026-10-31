package telemetry_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/codeforces"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/telemetry"
)

func TestIngestionAndExporterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.sqlite")
	store, err := sqlite.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	metrics := telemetry.New(store)
	ingest := metrics.Ingest("secret")
	tests := []struct {
		token, body string
		status      int
	}{
		{"", `{"id":"event-00000000001","kind":"page_view","mode":"live"}`, 401},
		{"secret", `{"id":"event-00000000001","kind":"page_view","mode":"handle"}`, 400},
		{"secret", `{"id":"event-00000000001","kind":"page_view","mode":"live","handle":"secret-user"}`, 400},
		{"secret", `{"id":"event-00000000001","kind":"view_displayed","mode":"live","seconds":-1}`, 400},
		{"secret", `{"id":"event-00000000001","kind":"page_view","mode":"live"} {}`, 400},
		{"secret", `{"id":"event-00000000001","kind":"page_view","mode":"live"}`, 204},
		{"secret", `{"id":"event-00000000001","kind":"page_view","mode":"live"}`, 204},
		{"secret", `{"id":"event-00000000002","kind":"view_displayed","mode":"demo","seconds":2}`, 204},
		{"secret", `{"id":"event-00000000003","kind":"loading_failed","mode":"replay"}`, 204},
		{"secret", `{"id":"event-00000000003","kind":"loading_failed","mode":"replay"}`, 204},
	}
	for _, test := range tests {
		req := httptest.NewRequest("POST", "/v1/telemetry", strings.NewReader(test.body))
		req.Header.Set("Authorization", "Bearer "+test.token)
		res := httptest.NewRecorder()
		ingest(res, req)
		if res.Code != test.status {
			t.Fatalf("%s: got %d want %d", test.body, res.Code, test.status)
		}
	}
	scrape := func(m *telemetry.Metrics) string {
		res := httptest.NewRecorder()
		m.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
		if res.Code != 200 {
			t.Fatal(res.Body.String())
		}
		return res.Body.String()
	}
	before := scrape(metrics)
	for _, line := range []string{`cf_usage_page_views_total{mode="live"} 1`, `cf_usage_page_views_total{mode="setup"} 0`, `cf_usage_loading_failures_total{mode="replay"} 1`, `cf_usage_loading_duration_seconds_count{mode="demo"} 1`} {
		if !strings.Contains(before, line) {
			t.Fatalf("missing %s", line)
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = sqlite.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	after := scrape(telemetry.New(store))
	if !strings.Contains(after, `cf_usage_page_views_total{mode="live"} 1`) || !strings.Contains(after, `cf_usage_displayed_views_total{mode="demo"} 1`) {
		t.Fatal(after)
	}
	if strings.Contains(after, "secret-user") {
		t.Fatal("private labels")
	}
}

func TestHTTPMetricsBoundLabelsAndExcludeStreamLatency(t *testing.T) {
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "metrics.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	metrics := telemetry.New(store)
	handler := metrics.Instrument(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "events") {
			w.(http.Flusher).Flush()
		} else {
			w.WriteHeader(503)
		}
	}))
	for _, path := range []string{"/v1/contests/123/events?h=secret-handle", "/v1/contests/456/activate", "/secret-path"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
	}
	res := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
	body := res.Body.String()
	if strings.Contains(body, "secret") || strings.Contains(body, `cf_backend_request_duration_seconds_count{method="GET",route="events"}`) {
		t.Fatal(body)
	}
	for _, route := range []string{"activate", "other"} {
		if !strings.Contains(body, fmt.Sprintf(`cf_backend_requests_total{method="GET",route="%s",status="503"} 1`, route)) {
			t.Fatal(body)
		}
	}
}

func TestHTTPMetricsCompletionAndPanic(t *testing.T) {
	for _, test := range []struct {
		name        string
		path        string
		status      int
		panics      bool
		wantStatus  int
		wantLatency bool
	}{
		{"implicit success", "/healthz", 0, false, 200, true},
		{"panic before headers", "/healthz", 0, true, 500, true},
		{"panic after headers", "/healthz", 202, true, 202, true},
		{"stream", "/v1/contests/123/events", 200, false, 200, false},
		{"bad stream request", "/v1/contests/123/events", 400, false, 400, true},
		{"missing stream", "/v1/contests/123/events", 404, false, 404, true},
		{"failed stream", "/v1/contests/123/events", 500, false, 500, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			metrics := telemetry.New(&blockingStore{})
			handler := metrics.Instrument(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if test.status != 0 {
					w.WriteHeader(test.status)
				}
				if test.panics {
					panic("handler failed")
				}
			}))
			func() {
				defer func() {
					recovered := recover()
					if (recovered != nil) != test.panics {
						t.Fatalf("panic propagation: %v", recovered)
					}
				}()
				handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", test.path, nil))
			}()
			res := httptest.NewRecorder()
			metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
			route := "health"
			if strings.HasSuffix(test.path, "/events") {
				route = "events"
			}
			want := fmt.Sprintf(`cf_backend_requests_total{method="GET",route="%s",status="%d"} 1`, route, test.wantStatus)
			if !strings.Contains(res.Body.String(), want) {
				t.Fatalf("missing %s", want)
			}
			latency := fmt.Sprintf(`cf_backend_request_duration_seconds_count{method="GET",route="%s"} 1`, route)
			if strings.Contains(res.Body.String(), latency) != test.wantLatency {
				t.Fatal(res.Body.String())
			}
		})
	}
}

type blockingStore struct {
	entered chan context.Context
}

func (s *blockingStore) SaveEvent(ctx context.Context, _ telemetry.Event, _ time.Time) (bool, error) {
	s.entered <- ctx
	<-ctx.Done()
	return false, ctx.Err()
}
func (*blockingStore) UsageTotals(context.Context) ([]telemetry.Total, error) {
	return telemetry.KnownTotals(), nil
}

func TestIngestionAdmissionAndCancellation(t *testing.T) {
	store := &blockingStore{entered: make(chan context.Context, 1)}
	ingest := telemetry.New(store).Ingest("secret")
	request := func(ctx context.Context) *http.Request {
		r := httptest.NewRequest("POST", "/v1/telemetry", strings.NewReader(`{"id":"event-00000000001","kind":"page_view","mode":"live"}`)).WithContext(ctx)
		r.Header.Set("Authorization", "Bearer secret")
		return r
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ingest(httptest.NewRecorder(), request(ctx))
	}()
	select {
	case storedContext := <-store.entered:
		if _, ok := storedContext.Deadline(); !ok {
			t.Fatal("missing ingestion deadline")
		}
	case <-time.After(time.Second):
		t.Fatal("first request never reached store")
	}
	res := httptest.NewRecorder()
	ingest(res, request(context.Background()))
	if res.Code != 429 || res.Header().Get("Retry-After") != "1" {
		t.Fatalf("overload response: %v", res)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("request cancellation did not reach store")
	}
	// The admission slot must be returned after cancellation.
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	res = httptest.NewRecorder()
	ingest(res, request(ctx))
	if res.Code != 503 {
		t.Fatalf("slot was not released: %d", res.Code)
	}
}

type stalledTotalsStore struct{ blockingStore }

func (*stalledTotalsStore) UsageTotals(ctx context.Context) ([]telemetry.Total, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestScrapeBoundsTotalsReadAndFailsInsteadOfExportingZero(t *testing.T) {
	metrics := telemetry.New(&stalledTotalsStore{})
	res := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
	}()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("scrape did not bound the totals read")
	}
	if res.Code != http.StatusInternalServerError {
		t.Fatalf("got %d: %s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "context deadline exceeded") {
		t.Fatal(res.Body.String())
	}
	if strings.Contains(res.Body.String(), `cf_usage_page_views_total{mode="live"} 0`) {
		t.Fatal("failed scrape exported false zero")
	}
}

func TestSubmissionHistoryMetrics(t *testing.T) {
	metrics := telemetry.New(&blockingStore{})
	for _, missing := range []int{0, 1, 1, 3, 0} {
		metrics.ObserveSubmissionHistory(missing)
	}
	res := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
	if res.Code != http.StatusOK {
		t.Fatal(res.Body.String())
	}
	for _, line := range []string{
		`cf_codeforces_submission_responses_total{history="consistent"} 2`,
		`cf_codeforces_submission_responses_total{history="missing_known"} 3`,
		`cf_codeforces_submission_omissions_total 5`,
	} {
		if !strings.Contains(res.Body.String(), line) {
			t.Fatalf("missing %s", line)
		}
	}
	// Operational observations reset across process restarts, unlike usage totals.
	res = httptest.NewRecorder()
	telemetry.New(&blockingStore{}).Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
	for _, line := range []string{
		`cf_codeforces_submission_responses_total{history="consistent"} 0`,
		`cf_codeforces_submission_responses_total{history="missing_known"} 0`,
		`cf_codeforces_submission_omissions_total 0`,
	} {
		if !strings.Contains(res.Body.String(), line) {
			t.Fatalf("missing %s", line)
		}
	}
}

func TestLivePollTracksPartialUpstreamHistory(t *testing.T) {
	contest := domain.Contest{ID: 42, Phase: "CODING"}
	var statusCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var result any = domain.Standings{Contest: contest}
		if r.URL.Path == "/contest.status" {
			ids := []int{101, 102, 103}
			switch statusCalls.Add(1) {
			case 1:
				ids = []int{101, 102}
			case 2:
				ids = []int{102, 103}
			}
			submissions := make([]domain.Submission, 0, len(ids))
			for _, id := range ids {
				submissions = append(submissions, domain.Submission{ID: id, ContestID: 42})
			}
			result = submissions
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "OK", "result": result})
	}))
	defer upstream.Close()
	store, err := sqlite.Open(filepath.Join(t.TempDir(), "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	metrics := telemetry.New(store)
	manager := application.NewManager(store, codeforces.NewClient(upstream.URL+"/", upstream.Client(), 0, codeforces.WithRequestObserver(metrics)), application.Config{
		PollInterval: time.Millisecond, MaxActiveContests: 1, SubmissionHistoryObserver: metrics,
	})
	session, _, err := manager.Activate(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		manager.Stop()
		select {
		case <-session.Stopped():
		case <-time.After(time.Second):
			t.Error("live session did not stop")
		}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for {
		res := httptest.NewRecorder()
		metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
		if statusCalls.Load() >= 3 && strings.Contains(res.Body.String(), `cf_codeforces_submission_responses_total{history="missing_known"} 1`) {
			if !strings.Contains(res.Body.String(), "cf_codeforces_submission_omissions_total 1") {
				t.Fatal(res.Body.String())
			}
			for _, method := range []string{"contest.status", "contest.standings"} {
				prefix := fmt.Sprintf(`cf_codeforces_request_duration_seconds_count{method="%s",outcome="success"} `, method)
				if !strings.Contains(res.Body.String(), prefix) || strings.Contains(res.Body.String(), prefix+"0\n") {
					t.Fatalf("live call latency missing: %s", res.Body.String())
				}
			}
			history, err := store.LoadSubmissions(42)
			if err != nil {
				t.Fatal(err)
			}
			if len(history) != 3 {
				t.Fatalf("retained history: %v", history)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("partial response not observed: %s", res.Body.String())
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCodeforcesLatencyMetricsBoundLabels(t *testing.T) {
	metrics := telemetry.New(&blockingStore{})
	metrics.ObserveCodeforcesRequest("contest.status", "success", 1500*time.Millisecond, 2*time.Second)
	metrics.ObserveCodeforcesRequest("contest.status", "timeout", 30*time.Second, 0)
	metrics.ObserveCodeforcesRequest("secret-url?contestId=42", "arbitrary error", time.Second, 0)
	res := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/metrics", nil))
	for _, line := range []string{
		`cf_codeforces_request_duration_seconds_count{method="contest.status",outcome="success"} 1`,
		`cf_codeforces_request_duration_seconds_sum{method="contest.status",outcome="success"} 1.5`,
		`cf_codeforces_request_duration_seconds_count{method="contest.status",outcome="timeout"} 1`,
		`cf_codeforces_rate_limit_wait_duration_seconds_count{method="contest.status"} 2`,
		`cf_codeforces_rate_limit_wait_duration_seconds_sum{method="contest.status"} 2`,
		`cf_codeforces_request_duration_seconds_count{method="other",outcome="other"} 1`,
	} {
		if !strings.Contains(res.Body.String(), line) {
			t.Fatalf("missing %s", line)
		}
	}
	if strings.Contains(res.Body.String(), "secret-url") || strings.Contains(res.Body.String(), "arbitrary error") {
		t.Fatal("unbounded labels exported")
	}
}
