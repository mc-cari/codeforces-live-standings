package codeforces

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type response struct {
	Status  string          `json:"status"`
	Result  json.RawMessage `json:"result"`
	Comment string          `json:"comment"`
}

// RequestObserver receives bounded API method/outcome names, never request URLs.
// Duration covers HTTP transport, body reading, and decoding; wait is local pacing.
type RequestObserver interface {
	ObserveCodeforcesRequest(method, outcome string, duration, wait time.Duration)
}

type ClientOption func(*Client)

// WithRequestObserver must be configured before the client starts serving calls.
func WithRequestObserver(observer RequestObserver) ClientOption {
	return func(client *Client) { client.observer = observer }
}

type Client struct {
	observer        RequestObserver
	baseURL         string
	httpClient      *http.Client
	minimumInterval time.Duration
	mu              sync.Mutex
	nextRequest     time.Time
}

func NewFreshConnectionHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DisableKeepAlives = true
	return &http.Client{Timeout: timeout, Transport: transport}
}

func NewClient(baseURL string, httpClient *http.Client, minimumInterval time.Duration, options ...ClientOption) *Client {
	client := &Client{baseURL: baseURL, httpClient: httpClient, minimumInterval: minimumInterval}
	for _, option := range options {
		option(client)
	}
	return client
}

func (client *Client) FetchSubmissions(ctx context.Context, contestID int) ([]domain.Submission, error) {
	var result []domain.Submission
	return result, client.fetch(ctx, "contest.status", contestID, &result)
}

func (client *Client) FetchStandings(ctx context.Context, contestID int) (domain.Standings, error) {
	var result domain.Standings
	return result, client.fetch(ctx, "contest.standings", contestID, &result)
}

func (client *Client) fetch(ctx context.Context, method string, contestID int, target any) error {
	queuedAt := time.Now()
	client.mu.Lock()
	if wait := time.Until(client.nextRequest); wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			client.mu.Unlock()
			return ctx.Err()
		}
	}
	client.nextRequest = time.Now().Add(client.minimumInterval)
	client.mu.Unlock()
	waited := time.Since(queuedAt)

	query := url.Values{"contestId": {strconv.Itoa(contestID)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+method+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "cf-live-desk/1.0")
	started := time.Now()
	outcome := "transport_error"
	defer func() {
		if client.observer != nil {
			client.observer.ObserveCodeforcesRequest(method, outcome, time.Since(started), waited)
		}
	}()
	result, err := client.httpClient.Do(request)
	if err != nil {
		outcome = transportOutcome(err)
		return err
	}
	defer result.Body.Close()
	body, err := io.ReadAll(result.Body)
	if err != nil {
		outcome = transportOutcome(err)
		return err
	}
	outcome = "decode_error"
	if result.StatusCode != http.StatusOK {
		outcome = "http_error"
	}
	var envelope response
	if err := json.Unmarshal(body, &envelope); err != nil {
		return err
	}
	if result.StatusCode != http.StatusOK {
		return fmt.Errorf("codeforces %s: %s", method, envelope.Comment)
	}
	if envelope.Status != "OK" {
		outcome = "api_error"
		return fmt.Errorf("codeforces %s: %s", method, envelope.Comment)
	}
	if err := json.Unmarshal(envelope.Result, target); err != nil {
		return err
	}
	outcome = "success"
	return nil
}

func transportOutcome(err error) string {
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	var networkError net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &networkError) && networkError.Timeout()) {
		return "timeout"
	}
	return "transport_error"
}
