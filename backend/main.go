package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/codeforces"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/adapters/livev3"
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

	penaltyOverrides := map[int]int{}
	if raw := os.Getenv("CF_ICPC_PENALTY_OVERRIDES"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &penaltyOverrides); err != nil {
			slog.Error("invalid CF_ICPC_PENALTY_OVERRIDES", "error", err)
			os.Exit(1)
		}
		for id, minutes := range penaltyOverrides {
			if id <= 0 || minutes < 0 {
				slog.Error("invalid ICPC penalty override", "contest", id, "minutes", minutes)
				os.Exit(1)
			}
		}
	}
	metrics := telemetry.New(repository)
	upstream := codeforces.NewClient(
		strings.TrimRight(env("CF_API_BASE_URL", defaultCodeforces), "/")+"/",
		codeforces.NewFreshConnectionHTTPClient(30*time.Second),
		2100*time.Millisecond,
		codeforces.WithRequestObserver(metrics),
		codeforces.WithPenaltyOverrides(penaltyOverrides),
	)
	sourceName := env("STANDINGS_SOURCE", "codeforces")
	scoped, err := repository.Scope(sourceName)
	if err != nil {
		slog.Error("configure contest storage failed", "error", err)
		os.Exit(1)
	}
	var gateway application.ContestGateway = upstream
	if sourceName == "livev3" {
		source, err := livev3.New(livev3.Config{
			ICPCPenaltyOverrides: penaltyOverrides,
			Binary:               env("LIVE_V3_CONVERTER", "/opt/live-v3/bin/cds-converter"),
			APIBaseURL:           env("CF_API_BASE_URL", defaultCodeforces),
			APIKey:               os.Getenv("CF_API_KEY"), APISecret: os.Getenv("CF_API_SECRET"),
			ManagerMode: env("CF_MANAGER_MODE", "false") == "true",
			MaxWorkers:  3, Store: scoped,
		})
		if err != nil {
			slog.Error("configure contest source failed", "error", err)
			os.Exit(1)
		}
		gateway = source
	}
	manager := application.NewManager(scoped, gateway, application.Config{
		PollInterval: 4200 * time.Millisecond, RetentionPeriod: retentionPeriod,
		MaxActiveContests: 3, SubmissionHistoryObserver: metrics,
	})
	var provider application.LiveStandingsProvider = manager
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
			if err := repository.CleanupReceipts(ctx, time.Now().Add(-24*time.Hour)); err != nil {
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
	maxStreams, err := strconv.Atoi(env("MAX_SSE_CONNECTIONS", "128"))
	if err != nil || maxStreams <= 0 {
		slog.Error("MAX_SSE_CONNECTIONS must be a positive integer")
		os.Exit(1)
	}
	server := &http.Server{
		Addr:    env("LISTEN_ADDR", defaultListen),
		Handler: httpapi.NewServer(provider, httpapi.Config{Metrics: metrics, TelemetryToken: os.Getenv("TELEMETRY_TOKEN"), AllowedOrigins: splitCSV(env("ALLOWED_ORIGINS", os.Getenv("ALLOWED_ORIGIN"))), MaxHandles: 200, MaxStreams: maxStreams}),
	}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		manager.Stop()
		_ = server.Shutdown(shutdownCtx)
		_ = metricsServer.Shutdown(shutdownCtx)
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
