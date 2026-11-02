// Package livev3 adapts the standard CDS converter CLICS API to application views.
package livev3

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/audit"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type Config struct {
	ICPCPenaltyOverrides map[int]int
	Binary               string
	APIBaseURL           string
	APIKey               string
	APISecret            string
	ManagerMode          bool
	MaxWorkers           int
	ReadyTimeout         time.Duration
	Store                application.ViewRepository
}
type result struct {
	view application.ContestUpdate
	err  error
}
type worker struct {
	cancel  context.CancelFunc
	done    chan struct{}
	ready   chan struct{}
	updates chan result
	initial result
}
type Client struct {
	config  Config
	audit   *audit.Reporter
	mu      sync.Mutex
	workers map[int]*worker
}

var _ application.ContestGateway = (*Client)(nil)
var _ application.StreamingGateway = (*Client)(nil)

func New(config Config) (*Client, error) {
	if config.Binary == "" {
		return nil, errors.New("LIVE_V3_CONVERTER is required")
	}
	binary, err := exec.LookPath(config.Binary)
	if err != nil {
		return nil, fmt.Errorf("converter binary: %w", err)
	}
	binary, err = filepath.Abs(binary)
	if err != nil {
		return nil, err
	}
	config.Binary = binary
	if config.MaxWorkers <= 0 {
		config.MaxWorkers = 3
	}
	if config.ReadyTimeout <= 0 {
		config.ReadyTimeout = 60 * time.Second
	}
	if config.APIBaseURL == "" {
		config.APIBaseURL = "https://codeforces.com/api/"
	}
	return &Client{config: config, workers: make(map[int]*worker), audit: audit.NewReporter()}, nil
}
func (c *Client) get(id int) (*worker, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if w := c.workers[id]; w != nil {
		return w, nil
	}
	if len(c.workers) >= c.config.MaxWorkers {
		return nil, errors.New("converter capacity reached")
	}
	ctx, cancel := context.WithCancel(context.Background())
	w := &worker{cancel: cancel, done: make(chan struct{}), ready: make(chan struct{}), updates: make(chan result, 1)}
	c.workers[id] = w
	go func() { defer close(w.done); c.run(ctx, id, w) }()
	return w, nil
}
func (c *Client) StopContest(id int) {
	c.mu.Lock()
	w := c.workers[id]
	if w != nil {
		w.cancel()
	}
	c.mu.Unlock()
	if w != nil {
		<-w.done
		c.mu.Lock()
		if c.workers[id] == w {
			delete(c.workers, id)
		}
		c.mu.Unlock()
	}
}
func (c *Client) FetchStandings(ctx context.Context, id int) (domain.Standings, error) {
	w, err := c.get(id)
	if err != nil {
		return domain.Standings{}, err
	}
	timer := time.NewTimer(c.config.ReadyTimeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		c.StopContest(id)
		return domain.Standings{}, ctx.Err()
	case <-timer.C:
		c.StopContest(id)
		return domain.Standings{}, errors.New("converter readiness timeout")
	case <-w.ready:
		if w.initial.err != nil {
			c.StopContest(id)
		}
		return w.initial.view.Standings, w.initial.err
	}
}
func (c *Client) InitialUpdate(ctx context.Context, id int) (application.ContestUpdate, error) {
	if _, err := c.FetchStandings(ctx, id); err != nil {
		return application.ContestUpdate{}, err
	}
	c.mu.Lock()
	w := c.workers[id]
	c.mu.Unlock()
	if w == nil {
		return application.ContestUpdate{}, errors.New("converter stopped during activation")
	}
	return w.initial.view, w.initial.err
}
func (c *Client) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return nil, errors.New("stream source does not poll submissions")
}
func (c *Client) Stream(ctx context.Context, id int, publish func(application.ContestUpdate) error) error {
	w, err := c.get(id)
	if err != nil {
		return err
	}
	defer c.StopContest(id)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case value, ok := <-w.updates:
			if !ok {
				return errors.New("converter stopped")
			}
			if value.err != nil {
				return value.err
			}
			if err := publish(value.view); err != nil {
				return err
			}
			if value.view.Finished {
				return nil
			}
		}
	}
}
func (c *Client) run(ctx context.Context, id int, w *worker) {
	first := true
	send := func(value result) {
		if first {
			w.initial = value
			close(w.ready)
			first = false
		}
		select {
		case <-w.updates:
		default:
		}
		select {
		case w.updates <- value:
		case <-ctx.Done():
		}
	}
	defer close(w.updates)
	err := c.convert(ctx, id, func(view application.ContestUpdate) { send(result{view: view}) })
	if err != nil {
		send(result{err: err})
	}
	if first {
		send(result{err: errors.New("converter exited before readiness")})
	}
}
func (c *Client) convert(ctx context.Context, id int, publish func(application.ContestUpdate)) error {
	dir, err := os.MkdirTemp("", "standings-converter-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	settings := map[string]any{"type": "cf", "contestId": id, "asManager": c.config.ManagerMode, "includeUnofficial": true, "baseUrl": c.config.APIBaseURL}
	if c.config.ManagerMode {
		settings["apiKey"] = c.config.APIKey
		settings["apiSecret"] = c.config.APISecret
	}
	if minutes, ok := c.config.ICPCPenaltyOverrides[id]; ok {
		settings["penaltyPerWrongAttemptMinutes"] = minutes
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(dir, "settings.json"), data, 0600); err != nil {
		return err
	}
	// The converter accepts Ktor's host setting; only Go can reach this worker.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	command := exec.CommandContext(ctx, c.config.Binary, "server", "--config-directory", dir, "--port", strconv.Itoa(port), "--ktor-arg=-host=127.0.0.1", "--no-auto-finalize")
	command.Dir = dir
	command.Stdout = os.Stderr
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()
	defer func() {
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		<-exited
	}()
	base := fmt.Sprintf("http://127.0.0.1:%d/clics/api/contests/contest", port)
	client := &http.Client{Timeout: 10 * time.Second}
	readyCtx, cancel := context.WithTimeout(ctx, c.config.ReadyTimeout)
	defer cancel()
	for {
		req, _ := http.NewRequestWithContext(readyCtx, "GET", base+"/scoreboard?x_live=true&include_unofficial=true", nil)
		resp, e := client.Do(req)
		if e == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				break
			}
		}
		select {
		case <-readyCtx.Done():
			return readyCtx.Err()
		case err := <-exited:
			exited <- err
			return fmt.Errorf("converter exited: %v", err)
		case <-time.After(100 * time.Millisecond):
		}
	}
	return c.consume(ctx, id, base, publish)
}

func (c *Client) consume(ctx context.Context, id int, base string, publish func(application.ContestUpdate)) error {
	client := &http.Client{Timeout: 10 * time.Second}
	streamCtx, stop := context.WithCancel(ctx)
	defer stop()
	req, _ := http.NewRequestWithContext(streamCtx, "GET", base+"/event-feed?x_live=true", nil)
	req.Header.Set("Accept-Encoding", "identity")
	response, err := (&http.Client{}).Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("CLICS feed HTTP %d", response.StatusCode)
	}
	events := make(chan feedEvent, 256)
	fail := make(chan error, 1)
	go func() {
		defer close(events)
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 65536), 16<<20)
		for scanner.Scan() {
			if len(scanner.Bytes()) == 0 {
				continue
			}
			var event feedEvent
			if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
				fail <- err
				return
			}
			select {
			case events <- event:
			case <-streamCtx.Done():
				return
			}
		}
		err := scanner.Err()
		if err == nil {
			err = io.EOF
		}
		fail <- err
	}()
	entities := make(map[string]map[string][]byte)
	if c.config.Store != nil {
		saved, e := c.config.Store.LoadView(id)
		if e != nil {
			return e
		}
		if saved != nil && saved.Entities != nil {
			entities = stageFreshTeamEntities(saved.Entities)
		}
	}
	currentToken := ""
	lastBoard := time.Time{}
	instance := ""
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
		if len(events) == 0 {
			select {
			case err := <-fail:
				return err
			default:
			}
			if currentToken != "" && time.Since(lastBoard) < 5*time.Second {
				continue
			}
		}
		lastBoard = time.Now()
		var board scoreboard
		if err := getJSON(ctx, client, base+"/scoreboard?x_live=true&include_unofficial=true", &board); err != nil {
			return err
		}
		if board.Live.Instance == "" || board.Live.Watermark == "" {
			return errors.New("converter lacks x_live synchronization metadata")
		}
		if instance != "" && instance != board.Live.Instance {
			return errors.New("converter feed instance changed")
		}
		instance = board.Live.Instance
		if currentToken == board.Live.Watermark {
			continue
		}
		// Do not consume beyond this scoreboard's watermark. Later events stay staged
		// in the bounded reader channel until a matching calculated scoreboard arrives.
		for currentToken != board.Live.Watermark {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case event, ok := <-events:
				if !ok {
					select {
					case e := <-fail:
						return e
					default:
						return io.EOF
					}
				}
				if event.Live.Instance != instance {
					return errors.New("feed and scoreboard instances differ")
				}
				applyEvent(entities, event)
				currentToken = event.Token
			}
		}
		view, err := normalize(id, entities, board)
		if err != nil {
			return err
		}
		c.auditUpdate(view, entities)
		publish(view)
		if view.Finished {
			return nil
		}
	}
}

// A restarted engine publishes a complete team catalogue with new identity spelling.
// Keep the saved published view untouched while the fresh feed is staged, but do not
// seed the new catalogue with IDs from the prior worker.
func stageFreshTeamEntities(saved map[string]map[string][]byte) map[string]map[string][]byte {
	staged := make(map[string]map[string][]byte, len(saved)+1)
	for resource, values := range saved {
		if resource == "teams" { continue }
		copy := make(map[string][]byte, len(values))
		for id, payload := range values { copy[id] = payload }
		staged[resource] = copy
	}
	staged["teams"] = make(map[string][]byte)
	return staged
}

func (c *Client) auditUpdate(view application.ContestUpdate, entities map[string]map[string][]byte) {
	submissions := make([]domain.Submission, 0, len(view.Submissions))
	for _, submission := range view.Submissions {
		submissions = append(submissions, submission)
	}
	c.audit.ObserveSubmissions(view.Standings, submissions)
	for _, payload := range entities["runs"] {
		var item entity
		if json.Unmarshal(payload, &item) != nil {
			continue
		}
		raw := item.Live.Fields["codeforces.hack"]
		if raw == "" {
			continue
		}
		var hack struct {
			ID                  int          `json:"id"`
			CreationTimeSeconds int64        `json:"creationTimeSeconds"`
			Hacker              domain.Party `json:"hacker"`
			Defender            domain.Party `json:"defender"`
		}
		if json.Unmarshal([]byte(raw), &hack) == nil {
			c.audit.ObserveHack(view.Standings.Contest, hack.ID, hack.CreationTimeSeconds, hack.Hacker, hack.Defender, view.Standings)
		}
	}
}
func getJSON(ctx context.Context, client *http.Client, url string, value any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("CLICS HTTP %d", response.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(response.Body, 64<<20)).Decode(value)
}
