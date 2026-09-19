package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
)

type Config struct {
	AllowedOrigin  string
	AllowedOrigins []string
	MaxHandles    int
}

type Server struct {
	manager       *application.Manager
	allowedOrigins []string
	maxHandles    int
}

func NewServer(manager *application.Manager, config Config) http.Handler {
	if config.MaxHandles <= 0 {
		config.MaxHandles = 200
	}
	allowedOrigins := append([]string{}, config.AllowedOrigins...)
	if len(allowedOrigins) == 0 && config.AllowedOrigin != "" {
		allowedOrigins = []string{config.AllowedOrigin}
	}
	server := &Server{manager: manager, allowedOrigins: allowedOrigins, maxHandles: config.MaxHandles}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", server.health)
	mux.HandleFunc("/readyz", server.ready)
	mux.HandleFunc("/v1/contests/", server.contest)
	return server.cors(mux)
}

func (server *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if server.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (server *Server) originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, pattern := range server.allowedOrigins {
		pattern = strings.TrimSpace(pattern)
		if pattern == origin {
			return true
		}
		if wildcardOriginMatches(pattern, origin) {
			return true
		}
	}
	return false
}

func wildcardOriginMatches(pattern, origin string) bool {
	star := strings.IndexByte(pattern, '*')
	if star < 0 {
		return false
	}
	prefix, suffix := pattern[:star], pattern[star+1:]
	return strings.HasPrefix(origin, prefix) && strings.HasSuffix(origin, suffix) && len(origin) >= len(prefix)+len(suffix)
}

func (server *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) ready(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (server *Server) contest(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 4 || parts[0] != "v1" || parts[1] != "contests" {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.Atoi(parts[2])
	if err != nil || id <= 0 {
		http.Error(w, "invalid contest id", http.StatusBadRequest)
		return
	}
	switch {
	case parts[3] == "activate" && r.Method == http.MethodPost:
		server.activate(w, r, id)
	case parts[3] == "events" && r.Method == http.MethodGet:
		server.events(w, r, id)
	default:
		http.NotFound(w, r)
	}
}

func (server *Server) activate(w http.ResponseWriter, r *http.Request, id int) {
	session, _, err := server.manager.Activate(r.Context(), id)
	if err != nil {
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "capacity") {
			status = http.StatusTooManyRequests
		}
		writeJSON(w, status, map[string]string{"comment": err.Error()})
		return
	}
	contest := session.Contest()
	state := "warming"
	if finished, _ := session.Status(); finished {
		state = "finished"
	} else {
		state = "live"
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": state, "contest": contest})
}

func (server *Server) events(w http.ResponseWriter, r *http.Request, id int) {
	session := server.manager.Get(id)
	if session == nil {
		http.Error(w, "contest is not activated", http.StatusNotFound)
		return
	}
	handles, err := decodeHandles(r.URL.Query().Get("h"), server.maxHandles)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	subscription := session.Subscribe(handles)
	defer session.Unsubscribe(subscription)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case event := <-subscription.Events:
			if err := writeEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-subscription.Done:
			return
		case <-r.Context().Done():
			return
		}
	}
}

func decodeHandles(encoded string, max int) ([]string, error) {
	if encoded == "" {
		return nil, errors.New("handles are required")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(encoded)
	}
	if err != nil {
		return nil, errors.New("invalid handles encoding")
	}
	seen := make(map[string]struct{})
	handles := make([]string, 0)
	for _, value := range strings.Split(string(decoded), ";") {
		handle := strings.TrimSpace(value)
		key := strings.ToLower(handle)
		if handle == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		handles = append(handles, handle)
		if len(handles) > max {
			return nil, fmt.Errorf("too many handles (maximum %d)", max)
		}
	}
	if len(handles) == 0 {
		return nil, errors.New("handles are required")
	}
	return handles, nil
}

func writeEvent(w http.ResponseWriter, event application.Event) error {
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", event.Revision, event.Kind, payload); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
