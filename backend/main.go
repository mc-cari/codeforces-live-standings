package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/codeforces"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/transport/httpapi"
)

const (
	defaultListen     = ":8080"
	defaultCodeforces = "https://codeforces.com/api/"
	retentionPeriod   = 7 * 24 * time.Hour
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dataDir := env("DATA_DIR", "/data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		slog.Error("create data directory failed", "error", err)
		os.Exit(1)
	}
	repository, err := sqlite.Open(filepath.Join(dataDir, "live.sqlite"))
	if err != nil {
		slog.Error("store failed", "error", err)
		os.Exit(1)
	}
	defer repository.Close()

	upstream := codeforces.NewClient(
		strings.TrimRight(env("CF_API_BASE_URL", defaultCodeforces), "/")+"/",
		&http.Client{Timeout: 30 * time.Second},
		2100*time.Millisecond,
	)
	manager := application.NewManager(repository, upstream, application.Config{
		PollInterval:      4200 * time.Millisecond,
		RetentionPeriod:   retentionPeriod,
		MaxActiveContests: 3,
	})
	if err := manager.Restore(ctx); err != nil {
		slog.Error("restore active contests failed", "error", err)
		os.Exit(1)
	}
	go manager.RunCleanup(ctx, time.Hour)

	server := &http.Server{
		Addr:    env("LISTEN_ADDR", defaultListen),
		Handler: httpapi.NewServer(manager, httpapi.Config{AllowedOrigin: os.Getenv("ALLOWED_ORIGIN"), MaxHandles: 200}),
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		manager.Stop()
	}()

	slog.Info("live backend listening", "addr", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
