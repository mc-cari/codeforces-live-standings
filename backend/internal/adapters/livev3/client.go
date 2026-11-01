package livev3

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type Client struct {
	base string
	http *http.Client
}

var _ application.LiveStandingsProvider = (*Client)(nil)

func NewClient(base string) (*Client, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return nil, fmt.Errorf("invalid LIVE_V3_ENGINE_URL")
	}
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: 130 * time.Second}}, nil
}

func (client *Client) request(ctx context.Context, method, path string, result any) (bool, error) {
	request, err := http.NewRequestWithContext(ctx, method, client.base+path, nil)
	if err != nil {
		return false, err
	}
	response, err := client.http.Do(request)
	if err != nil {
		return false, fmt.Errorf("live-v3 engine unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return false, nil
	}
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusNotFound {
			return false, application.ErrContestInactive
		}
		if response.StatusCode == http.StatusTooManyRequests {
			return false, fmt.Errorf("live-v3 capacity reached")
		}
		if response.StatusCode == http.StatusConflict {
			return false, fmt.Errorf("contest is unsupported by live-v3")
		}
		return false, fmt.Errorf("live-v3 engine returned HTTP %d", response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<20)).Decode(result); err != nil {
		return false, fmt.Errorf("decode live-v3 response: %w", err)
	}
	return true, nil
}

func (client *Client) ActivateContest(ctx context.Context, id int) (application.Activation, error) {
	var value application.Activation
	changed, err := client.request(ctx, http.MethodPost, fmt.Sprintf("/internal/v1/contests/%d/activate", id), &value)
	if err == nil && (!changed || value.Contest.ID != id || value.State == "") {
		err = fmt.Errorf("invalid live-v3 activation response")
	}
	return value, err
}

func (client *Client) view(ctx context.Context, id int, handles []string, previous *application.Snapshot) (*application.Snapshot, error) {
	query := url.Values{"h": {base64.RawURLEncoding.EncodeToString([]byte(strings.Join(handles, ";")))}}
	if previous != nil {
		query.Set("after", strconv.FormatInt(previous.Revision, 10))
		query.Set("health", previous.Health.State)
	}
	var value application.Snapshot
	changed, err := client.request(ctx, http.MethodGet, fmt.Sprintf("/internal/v1/contests/%d/view?%s", id, query.Encode()), &value)
	if err != nil || !changed {
		return nil, err
	}
	if value.Contest.ID != id || value.Revision < 0 || value.Standings.Contest.ID != id {
		return nil, fmt.Errorf("invalid live-v3 view")
	}
	return &value, nil
}

func (client *Client) SubscribeContest(parent context.Context, id int, handles []string) (*application.Feed, error) {
	ctx, cancel := context.WithCancel(parent)
	initial, err := client.view(ctx, id, handles, nil)
	if err != nil || initial == nil {
		cancel()
		if err == nil {
			err = fmt.Errorf("live-v3 engine returned no initial view")
		}
		return nil, err
	}
	events := make(chan application.Event, 2)
	done := make(chan struct{})
	events <- snapshotEvent(initial)
	go func() {
		defer close(done)
		defer cancel()
		previous := initial
		resync := false
		for {
			pollPrevious := previous
			if resync {
				pollPrevious = nil
			}
			next, err := client.view(ctx, id, handles, pollPrevious)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				stale := *previous
				stale.Health.State = "stale"
				if !publish(ctx, events, snapshotEvent(&stale), &stale) {
					return
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
				resync = true
				continue
			}
			if next == nil {
				continue
			}
			event := update(previous, next)
			if resync {
				event = snapshotEvent(next)
				resync = false
			}
			if !publish(ctx, events, event, next) {
				return
			}
			if next.Health.State != previous.Health.State && (next.Health.State == "stale" || next.Health.State == "finished") {
				if !publish(ctx, events, application.Event{Kind: "state", Revision: next.Revision, Payload: application.State{State: next.Health.State, Contest: next.Contest}}, next) {
					return
				}
			}
			previous = next
		}
	}()
	return &application.Feed{Events: events, Done: done, Close: cancel}, nil
}

func snapshotEvent(value *application.Snapshot) application.Event {
	return application.Event{Kind: "snapshot", Revision: value.Revision, Payload: *value}
}

func update(previous, next *application.Snapshot) application.Event {
	if previous == nil || next.Revision != previous.Revision+1 {
		return snapshotEvent(next)
	}
	old := make(map[int]domain.Submission, len(previous.Submissions))
	for _, submission := range previous.Submissions {
		old[submission.ID] = submission
	}
	upserts := make([]domain.Submission, 0)
	for _, submission := range next.Submissions {
		if saved, exists := old[submission.ID]; !exists || !reflect.DeepEqual(saved, submission) {
			upserts = append(upserts, submission)
		}
		delete(old, submission.ID)
	}
	if len(old) != 0 {
		return snapshotEvent(next)
	}
	return application.Event{Kind: "patch", Revision: next.Revision, Payload: application.Patch{Revision: next.Revision, Contest: next.Contest, Standings: next.Standings, SubmissionUpserts: upserts, Health: next.Health}}
}

func publish(ctx context.Context, events chan application.Event, event application.Event, current *application.Snapshot) bool {
	select {
	case <-ctx.Done():
		return false
	default:
	}
	select {
	case events <- event:
	default:
		for {
			select {
			case <-events:
				continue
			default:
			}
			break
		}
		select {
		case events <- snapshotEvent(current):
		case <-ctx.Done():
			return false
		}
	}
	return true
}
