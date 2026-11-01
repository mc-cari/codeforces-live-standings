package adminapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/go-jose/go-jose/v4"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type emptyGateway struct{}

func (emptyGateway) FetchContests(context.Context) ([]domain.Contest, error) {
	return []domain.Contest{}, nil
}
func (emptyGateway) FetchStandings(context.Context, int) (domain.Standings, error) {
	return domain.Standings{}, nil
}
func (emptyGateway) FetchSubmissions(context.Context, int) ([]domain.Submission, error) {
	return nil, nil
}
func TestPrivateSettingsAPI(t *testing.T) {
	dir := t.TempDir()
	r, err := sqlite.Open(filepath.Join(dir, "live.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	manager := application.NewManager(r, emptyGateway{}, application.Config{PollInterval: time.Hour, MaxActiveContests: 3})
	collector, err := application.NewCollector(r, emptyGateway{}, manager, nil)
	if err != nil {
		t.Fatal(err)
	}
	assets := filepath.Join(dir, "assets")
	os.Mkdir(assets, 0755)
	os.WriteFile(filepath.Join(assets, "index.html"), []byte("admin application"), 0644)
	handler := NewServer(collector, Config{Development: true, Origin: "http://localhost:4321", AssetsDir: assets})
	for _, tc := range []struct {
		method, path, origin, content, body string
		want                                int
	}{
		{"GET", "/api/settings", "", "", "", 200}, {"GET", "/api/contests", "", "", "", 200}, {"GET", "/", "", "", "", 200},
		{"PUT", "/api/settings", "http://localhost:4321", "application/json", `{"mode":"selected","selectedContestIds":[42]}`, 200},
		{"PUT", "/api/settings", "https://evil.example", "application/json", `{"mode":"all"}`, 403},
		{"PUT", "/api/settings", "", "application/json", `{"mode":"all"}`, 403},
		{"PUT", "/api/settings", "http://localhost:4321", "text/plain", `{"mode":"all"}`, 415},
		{"PUT", "/api/settings", "http://localhost:4321", "application/json", `{"mode":"oops"}`, 400},
		{"PUT", "/api/settings", "http://localhost:4321", "application/json", `{"mode":"all"} {}`, 400},
		{"PUT", "/api/settings", "http://localhost:4321", "application/json", `{"mode":"all","unknown":1}`, 400},
		{"GET", "/api/no-such-endpoint", "", "", "", 404},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.RemoteAddr = "127.0.0.1:5000"
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Content-Type", tc.content)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s %s origin %s: got %d want %d: %s", tc.method, tc.path, tc.origin, w.Code, tc.want, w.Body)
		}
	}
	if collector.Settings().Mode != "selected" {
		t.Fatal("rejected writes modified settings")
	}
	for _, path := range []string{"/api/settings", "/api/contests", "/"} {
		w := httptest.NewRecorder()
		httpapi.NewServer(manager, httpapi.Config{}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatalf("public listener exposes %s", path)
		}
	}
	w := httptest.NewRecorder()
	NewServer(collector, Config{}).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 503 {
		t.Fatal("unconfigured authentication must fail closed")
	}
	req := httptest.NewRequest("GET", "/api/settings", nil)
	req.RemoteAddr = "192.0.2.1:4000"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("development allowed non-loopback access")
	}
}

type keyTransport struct{ body string }

func (k keyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(k.body)), Request: r}, nil
}
func TestAccessJWTValidation(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
	transport := http.DefaultTransport
	http.DefaultTransport = keyTransport{string(jwks)}
	defer func() { http.DefaultTransport = transport }()
	const team = "https://example.cloudflareaccess.com"
	handler := accessMiddleware(Config{Origin: "https://admin.example.com", AccessTeamDomain: team, AccessAudience: "admin-aud", AllowedEmail: "admin@example.com"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	sign := func(issuer, audience, email string, expiration int64) string {
		t.Helper()
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "test"}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		payload, _ := json.Marshal(map[string]any{"iss": issuer, "aud": []string{audience}, "email": email, "exp": expiration, "iat": time.Now().Unix()})
		obj, err := signer.Sign(payload)
		if err != nil {
			t.Fatal(err)
		}
		token, err := obj.CompactSerialize()
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	future := time.Now().Add(time.Hour).Unix()
	for _, tc := range []struct {
		token string
		want  int
	}{
		{"", 401}, {"invalid", 401}, {sign(team, "admin-aud", "admin@example.com", future), 204},
		{sign(team, "wrong-aud", "admin@example.com", future), 401},
		{sign("https://other.cloudflareaccess.com", "admin-aud", "admin@example.com", future), 401},
		{sign(team, "admin-aud", "other@example.com", future), 403},
		{sign(team, "admin-aud", "admin@example.com", time.Now().Add(-time.Hour).Unix()), 401},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Cf-Access-Jwt-Assertion", tc.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("got %d want %d", w.Code, tc.want)
		}
	}
}
