package codeforces

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFreshConnectionHTTPClientDoesNotReuseConnections(t *testing.T) {
	var opened atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			opened.Add(1)
		}
	}
	server.Start()
	defer server.Close()

	client := NewFreshConnectionHTTPClient(time.Second)
	for range 2 {
		response, err := client.Get(server.URL)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.Copy(io.Discard, response.Body); err != nil {
			response.Body.Close()
			t.Fatal(err)
		}
		response.Body.Close()
	}

	if got := opened.Load(); got != 2 {
		t.Fatalf("expected a fresh connection per request, opened %d", got)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type requestObservation struct {
	method, outcome string
	duration, wait  time.Duration
}
type requestRecorder struct{ calls []requestObservation }

func (recorder *requestRecorder) ObserveCodeforcesRequest(method, outcome string, duration, wait time.Duration) {
	recorder.calls = append(recorder.calls, requestObservation{method, outcome, duration, wait})
}

func TestRequestMetricsOutcomes(t *testing.T) {
	for _, test := range []struct {
		name, method, body, outcome string
		status                      int
		err                         error
	}{
		{"status success", "contest.status", `{"status":"OK","result":[]}`, "success", 200, nil},
		{"standings success", "contest.standings", `{"status":"OK","result":{"contest":{"id":42}}}`, "success", 200, nil},
		{"HTTP error", "contest.status", `<html>unavailable</html>`, "http_error", 502, nil},
		{"API error", "contest.status", `{"status":"FAILED","comment":"rate limited"}`, "api_error", 200, nil},
		{"invalid envelope", "contest.status", `{`, "decode_error", 200, nil},
		{"invalid result", "contest.status", `{"status":"OK","result":{}}`, "decode_error", 200, nil},
		{"network failure", "contest.status", "", "transport_error", 0, errors.New("network unavailable")},
		{"deadline", "contest.status", "", "timeout", 0, context.DeadlineExceeded},
		{"cancellation", "contest.status", "", "canceled", 0, context.Canceled},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := &requestRecorder{}
			transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if test.err != nil {
					return nil, test.err
				}
				return &http.Response{StatusCode: test.status, Body: io.NopCloser(strings.NewReader(test.body)), Header: make(http.Header)}, nil
			})
			client := NewClient("http://upstream.invalid/", &http.Client{Transport: transport}, 0, WithRequestObserver(recorder))
			var err error
			if test.method == "contest.status" {
				_, err = client.FetchSubmissions(context.Background(), 42)
			} else {
				_, err = client.FetchStandings(context.Background(), 42)
			}
			if (err == nil) != (test.outcome == "success") {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(recorder.calls) != 1 {
				t.Fatalf("observations: %v", recorder.calls)
			}
			got := recorder.calls[0]
			if got.method != test.method || got.outcome != test.outcome || got.duration < 0 || got.wait < 0 {
				t.Fatalf("observation: %+v", got)
			}
		})
	}
}

type delayedBody struct {
	io.Reader
	readAt time.Time
}

func (body *delayedBody) Read(p []byte) (int, error) {
	if body.readAt.IsZero() {
		time.Sleep(20 * time.Millisecond)
		body.readAt = time.Now()
	}
	return body.Reader.Read(p)
}
func (*delayedBody) Close() error { return nil }

func TestRequestTimingIncludesBodyAndSeparatesPacing(t *testing.T) {
	recorder := &requestRecorder{}
	body := &delayedBody{Reader: strings.NewReader(`{"status":"OK","result":[]}`)}
	var started time.Time
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		started = time.Now()
		return &http.Response{StatusCode: 200, Body: body, Header: make(http.Header)}, nil
	})
	client := NewClient("http://upstream.invalid/", &http.Client{Transport: transport}, 0, WithRequestObserver(recorder))
	client.nextRequest = time.Now().Add(80 * time.Millisecond)
	if _, err := client.FetchSubmissions(context.Background(), 42); err != nil {
		t.Fatal(err)
	}
	got := recorder.calls[0]
	if got.wait < 70*time.Millisecond {
		t.Fatalf("pacing wait not captured: %v", got.wait)
	}
	if got.duration < 20*time.Millisecond {
		t.Fatalf("body download not captured: %v", got.duration)
	}
	// The reported duration should match the actual HTTP phase, not include the
	// earlier 80ms local wait. Allow scheduling/observer overhead after dispatch.
	if got.duration > time.Since(started)+10*time.Millisecond {
		t.Fatalf("local wait leaked into HTTP duration: %v", got.duration)
	}
}

func TestCancellationWhileQueuedDoesNotRecordAPICall(t *testing.T) {
	recorder := &requestRecorder{}
	transport := roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("queued request reached HTTP transport")
		return nil, nil
	})
	client := NewClient("http://upstream.invalid/", &http.Client{Transport: transport}, time.Second, WithRequestObserver(recorder))
	client.nextRequest = time.Now().Add(time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.FetchSubmissions(ctx, 42); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	if len(recorder.calls) != 0 {
		t.Fatalf("unstarted call recorded: %v", recorder.calls)
	}
}

func TestFetchHacksDiscardsTestAndJudgeProtocols(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/contest.hacks" || r.URL.Query().Get("contestId") != "566" {
			t.Errorf("unexpected request: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"OK","result":[{"id":160429,"creationTimeSeconds":1438275141,"hacker":{"members":[{"handle":"Misha100896"}]},"defender":{"members":[{"handle":"fruwajacybyk"}]},"problem":{"index":"F"},"verdict":"HACK_SUCCESSFUL","test":"private test","judgeProtocol":{"manual":true}}]}`))
	}))
	defer server.Close()
	client := NewClient(server.URL+"/", server.Client(), 0)
	hacks, err := client.FetchHacks(context.Background(), 566)
	if err != nil || len(hacks) != 1 || hacks[0].ID != 160429 {
		t.Fatalf("fetch: %v %#v", err, hacks)
	}
	body, err := json.Marshal(hacks)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "private test") || strings.Contains(string(body), "judgeProtocol") {
		t.Fatal("hack test details retained")
	}
}
