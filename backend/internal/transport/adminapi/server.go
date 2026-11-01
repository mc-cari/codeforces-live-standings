// Package adminapi is mounted exclusively on the private admin listener.
package adminapi

import (
	"context"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
)

type Config struct {
	AssetsDir, Origin, AccessTeamDomain, AccessAudience, AllowedEmail string
	Development                                                       bool
}

func NewServer(collector *application.Collector, config Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/settings", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, collector.Settings()) })
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || contentType != "application/json" {
			http.Error(w, "application/json required", 415)
			return
		}
		if r.Header.Get("Origin") != config.Origin || config.Origin == "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "same-origin request required", 403)
			return
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
		decoder.DisallowUnknownFields()
		var settings application.CollectionSettings
		if err := decoder.Decode(&settings); err != nil {
			http.Error(w, "invalid settings JSON", 400)
			return
		}
		if decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "invalid settings JSON", 400)
			return
		}
		if err := settings.Validate(); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := collector.Update(r.Context(), settings); err != nil {
			http.Error(w, "could not persist settings; retry saving", 500)
			return
		}
		jsonResponse(w, collector.Settings())
	})
	mux.HandleFunc("GET /api/contests", func(w http.ResponseWriter, r *http.Request) {
		collector.Refresh(r.Context())
		jsonResponse(w, collector.Status())
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	mux.Handle("/", http.FileServer(http.Dir(config.AssetsDir)))
	protected := accessMiddleware(config, mux)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		protected.ServeHTTP(w, r)
	})
}
func jsonResponse(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
func accessMiddleware(config Config, next http.Handler) http.Handler {
	var verifier *oidc.IDTokenVerifier
	team := strings.TrimRight(config.AccessTeamDomain, "/")
	origin, originErr := url.Parse(config.Origin)
	if !config.Development && originErr == nil && origin.Scheme == "https" && origin.Host != "" && origin.Path == "" && strings.HasPrefix(team, "https://") && strings.HasSuffix(team, ".cloudflareaccess.com") && config.AccessAudience != "" && config.AllowedEmail != "" {
		client := &http.Client{Timeout: 10 * time.Second}
		ctx := oidc.ClientContext(context.Background(), client)
		verifier = oidc.NewVerifier(team, oidc.NewRemoteKeySet(ctx, team+"/cdn-cgi/access/certs"), &oidc.Config{ClientID: config.AccessAudience, SupportedSigningAlgs: []string{"RS256"}})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if config.Development {
			host, _, _ := net.SplitHostPort(r.RemoteAddr)
			if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
				http.Error(w, "development access requires loopback", 403)
				return
			}
		} else {
			if verifier == nil {
				http.Error(w, "admin authentication is not configured", 503)
				return
			}
			token, err := verifier.Verify(r.Context(), r.Header.Get("Cf-Access-Jwt-Assertion"))
			if err != nil {
				http.Error(w, "unauthorized", 401)
				return
			}
			var claims struct {
				Email string `json:"email"`
			}
			if token.Claims(&claims) != nil || !strings.EqualFold(claims.Email, config.AllowedEmail) {
				http.Error(w, "forbidden", 403)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
