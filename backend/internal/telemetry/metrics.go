package telemetry

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Store interface {
	SaveEvent(context.Context, Event, time.Time) (bool, error)
	UsageTotals(context.Context) ([]Total, error)
}

type Metrics struct {
	ingesting           chan struct{}
	store               Store
	registry            *prometheus.Registry
	desc                map[string]*prometheus.Desc
	failures            *prometheus.CounterVec
	loading             *prometheus.HistogramVec
	requests            *prometheus.CounterVec
	latency             *prometheus.HistogramVec
	SSE                 prometheus.Gauge
	submissionResponses *prometheus.CounterVec
	submissionOmissions prometheus.Counter
	codeforcesLatency   *prometheus.HistogramVec
	codeforcesWait      *prometheus.HistogramVec
}

func New(store Store) *Metrics {
	m := &Metrics{ingesting: make(chan struct{}, 1), store: store, registry: prometheus.NewRegistry(), desc: map[string]*prometheus.Desc{}}
	for kind, name := range map[string]string{"page_view": "page_views", "setup_completed": "completed_setups", "view_displayed": "displayed_views", "countdown_view": "countdown_views"} {
		m.desc[kind] = prometheus.NewDesc("cf_usage_"+name+"_total", "Lifetime committed "+kind+" events.", []string{"mode"}, nil)
	}
	m.failures = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "cf_usage_loading_failures_total", Help: "Failed initial loading attempts."}, []string{"mode"})
	m.loading = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "cf_usage_loading_duration_seconds", Help: "Time until scoreboard display, excluding countdown waiting.", Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300}}, []string{"mode"})
	m.requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "cf_backend_requests_total", Help: "Completed backend requests, including SSE streams."}, []string{"route", "method", "status"})
	m.latency = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "cf_backend_request_duration_seconds", Help: "Backend request latency excluding SSE streams.", Buckets: prometheus.DefBuckets}, []string{"route", "method"})
	m.SSE = prometheus.NewGauge(prometheus.GaugeOpts{Name: "cf_backend_sse_connections", Help: "Currently connected SSE clients."})
	m.submissionResponses = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "cf_codeforces_submission_responses_total", Help: "Successful contest.status responses compared with locally retained submission IDs."}, []string{"history"})
	m.submissionOmissions = prometheus.NewCounter(prometheus.CounterOpts{Name: "cf_codeforces_submission_omissions_total", Help: "Known submission IDs absent from successful contest.status responses; repeated omissions count again."})
	m.codeforcesLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "cf_codeforces_request_duration_seconds", Help: "Backend Codeforces HTTP call duration including body decoding, excluding local rate-limit wait.", Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60}}, []string{"method", "outcome"})
	m.codeforcesWait = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "cf_codeforces_rate_limit_wait_duration_seconds", Help: "Local pacing and mutex wait before started backend Codeforces calls.", Buckets: []float64{0.01, 0.1, 0.5, 1, 2, 3, 5, 10, 20, 30, 60}}, []string{"method"})
	for _, method := range []string{"contest.status", "contest.standings"} {
		m.codeforcesWait.WithLabelValues(method)
		for _, outcome := range []string{"success", "http_error", "api_error", "decode_error", "transport_error", "timeout", "canceled"} {
			m.codeforcesLatency.WithLabelValues(method, outcome)
		}
	}
	for _, history := range []string{"consistent", "missing_known"} {
		m.submissionResponses.WithLabelValues(history)
	}
	for _, mode := range []string{"live", "replay", "demo"} {
		m.failures.WithLabelValues(mode)
		m.loading.WithLabelValues(mode)
	}
	// Seed the known handler outcomes so dashboards show zero before the first
	// request or error, while keeping the label set bounded.
	for _, endpoint := range []struct {
		route, method string
		statuses      []string
	}{
		{"health", "GET", []string{"200"}},
		{"ready", "GET", []string{"200"}},
		{"telemetry", "POST", []string{"204", "400", "401", "429", "503"}},
		{"activate", "POST", []string{"200", "400", "404", "409", "429", "502"}},
		{"events", "GET", []string{"200", "400", "404", "500"}},
	} {
		for _, status := range endpoint.statuses {
			m.requests.WithLabelValues(endpoint.route, endpoint.method, status)
		}
		if endpoint.route != "events" {
			m.latency.WithLabelValues(endpoint.route, endpoint.method)
		}
	}
	m.registry.MustRegister(m, m.failures, m.loading, m.requests, m.latency, m.SSE, m.submissionResponses, m.submissionOmissions, m.codeforcesLatency, m.codeforcesWait)
	return m
}

// ObserveSubmissionHistory records upstream quality independently of database
// persistence or standings request failures. Missing IDs are counted per response.
func (m *Metrics) ObserveSubmissionHistory(missing int) {
	history := "consistent"
	if missing > 0 {
		history = "missing_known"
		m.submissionOmissions.Add(float64(missing))
	}
	m.submissionResponses.WithLabelValues(history).Inc()
}

// ObserveCodeforcesRequest bounds both label dimensions even for future callers.
func (m *Metrics) ObserveCodeforcesRequest(method, outcome string, duration, wait time.Duration) {
	switch method {
	case "contest.status", "contest.standings":
	default:
		method = "other"
	}
	switch outcome {
	case "success", "http_error", "api_error", "decode_error", "transport_error", "timeout", "canceled":
	default:
		outcome = "other"
	}
	m.codeforcesLatency.WithLabelValues(method, outcome).Observe(duration.Seconds())
	m.codeforcesWait.WithLabelValues(method).Observe(wait.Seconds())
}

func (m *Metrics) Describe(ch chan<- *prometheus.Desc) {
	for _, desc := range m.desc {
		ch <- desc
	}
}
func (m *Metrics) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	totals, err := m.store.UsageTotals(ctx)
	if err != nil {
		ch <- prometheus.NewInvalidMetric(m.desc["page_view"], err)
		return
	}
	for _, total := range totals {
		ch <- prometheus.MustNewConstMetric(m.desc[total.Kind], prometheus.CounterValue, total.Value, total.Mode)
	}
}
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
func (m *Metrics) Ingest(token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var event Event
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&event); err != nil {
			http.Error(w, "invalid event", 400)
			return
		}
		if decoder.Decode(new(any)) != io.EOF || event.Validate() != nil {
			http.Error(w, "invalid event", 400)
			return
		}
		// Keep optional telemetry from building a queue on the shared SQLite pool.
		select {
		case m.ingesting <- struct{}{}:
			defer func() { <-m.ingesting }()
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "telemetry busy", http.StatusTooManyRequests)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		inserted, err := m.store.SaveEvent(ctx, event, time.Now())
		if err != nil {
			http.Error(w, "telemetry unavailable", 503)
			return
		}
		if inserted {
			if event.Kind == "loading_failed" {
				m.failures.WithLabelValues(event.Mode).Inc()
			}
			if event.Kind == "view_displayed" {
				m.loading.WithLabelValues(event.Mode).Observe(*event.Seconds)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type responseStatus struct {
	http.ResponseWriter
	status int
}

func (w *responseStatus) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *responseStatus) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(data)
}
func (w *responseStatus) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *responseStatus) Flush() {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func (m *Metrics) Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		route := "other"
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		switch r.URL.Path {
		case "/healthz":
			route = "health"
		case "/readyz":
			route = "ready"
		case "/v1/telemetry":
			route = "telemetry"
		}
		if len(parts) == 4 && parts[0] == "v1" && parts[1] == "contests" {
			if parts[3] == "activate" {
				route = "activate"
			}
			if parts[3] == "events" {
				route = "events"
			}
		}
		method := r.Method
		if method != "GET" && method != "POST" && method != "OPTIONS" {
			method = "other"
		}
		start := time.Now()
		wrapped := &responseStatus{ResponseWriter: w}
		completed := false
		defer func() {
			status := wrapped.status
			if status == 0 && !completed {
				status = http.StatusInternalServerError
			} else if status == 0 {
				status = 200
			}
			m.requests.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
			if route != "events" || status != http.StatusOK {
				m.latency.WithLabelValues(route, method).Observe(time.Since(start).Seconds())
			}
		}()
		next.ServeHTTP(wrapped, r)
		completed = true
	})
}
