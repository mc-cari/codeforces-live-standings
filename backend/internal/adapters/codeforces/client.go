package codeforces

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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

type Client struct {
	baseURL         string
	httpClient      *http.Client
	minimumInterval time.Duration
	mu              sync.Mutex
	nextRequest     time.Time
}

func NewClient(baseURL string, httpClient *http.Client, minimumInterval time.Duration) *Client {
	return &Client{baseURL: baseURL, httpClient: httpClient, minimumInterval: minimumInterval}
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

	query := url.Values{"contestId": {strconv.Itoa(contestID)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+method+"?"+query.Encode(), nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "cf-live-desk/1.0")
	result, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer result.Body.Close()
	body, err := io.ReadAll(result.Body)
	if err != nil {
		return err
	}
	var envelope response
	if err := json.Unmarshal(body, &envelope); err != nil {
		return err
	}
	if result.StatusCode != http.StatusOK || envelope.Status != "OK" {
		return fmt.Errorf("codeforces %s: %s", method, envelope.Comment)
	}
	return json.Unmarshal(envelope.Result, target)
}
