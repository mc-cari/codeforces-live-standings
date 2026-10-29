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
	"github.com/mc-cari/codeforces-live-standings/backend/internal/telemetry"
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
		codeforces.NewFreshConnectionHTTPClient(30*time.Second),
		2100*time.Millisecond,
	)
	metrics := telemetry.New(repository)
	manager := application.NewManager(repository, upstream, application.Config{
		PollInterval:              4200 * time.Millisecond,
		RetentionPeriod:           retentionPeriod,
		MaxActiveContests:         3,
		SubmissionHistoryObserver: metrics,
	})
	if err := manager.Restore(ctx); err != nil {
		slog.Error("restore active contests failed", "error", err)
		os.Exit(1)
	}
	go manager.RunCleanup(ctx, time.Hour)

	metricsMux := http.NewServeMux()
	metricsMux.Handle("/metrics", metrics.Handler())
	metricsServer := &http.Server{Addr: env("METRICS_LISTEN_ADDR", "127.0.0.1:9090"), Handler: metricsMux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("metrics listener failed", "error", err)
		}
	}()
	go func() {
		cleanup := func() {
			if err := repository.CleanupReceipts(time.Now().Add(-24 * time.Hour)); err != nil {
				slog.Error("telemetry receipt cleanup failed", "error", err)
			}
		}
		cleanup()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				cleanup()
			case <-ctx.Done():
				return
			}
		}
	}()
	server := &http.Server{
		Addr:    env("LISTEN_ADDR", defaultListen),
		Handler: httpapi.NewServer(manager, httpapi.Config{Metrics: metrics, TelemetryToken: os.Getenv("TELEMETRY_TOKEN"), AllowedOrigins: splitCSV(env("ALLOWED_ORIGINS", os.Getenv("ALLOWED_ORIGIN"))), MaxHandles: 200}),
	}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		_ = metricsServer.Shutdown(shutdownCtx)
		manager.Stop()
	}()

	slog.Info("live backend listening", "addr", server.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
	<-shutdownDone
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
