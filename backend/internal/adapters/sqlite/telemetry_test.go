package sqlite

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/telemetry"
)

func TestUsageDurabilityAndConcurrentDeduplication(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.sqlite")
	repository, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := "shared-event-000000"
			if i%2 == 0 {
				id += fmt.Sprint(i)
			}
			_, err := repository.SaveEvent(context.Background(), telemetry.Event{ID: id, Kind: "page_view", Mode: "live"}, now)
			if err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	if err := repository.CleanupExpired(now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := repository.Close(); err != nil {
		t.Fatal(err)
	}
	repository, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	checkTotal := func() {
		t.Helper()
		totals, err := repository.UsageTotals(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, total := range totals {
			if total.Kind == "page_view" && total.Mode == "live" {
				if total.Value != 16 {
					t.Fatalf("total: %v", total)
				}
				return
			}
		}
		t.Fatal("missing total")
	}
	checkTotal()
	inserted, err := repository.SaveEvent(context.Background(), telemetry.Event{ID: "shared-event-000000", Kind: "page_view", Mode: "live"}, now)
	if err != nil || inserted {
		t.Fatalf("duplicate after reopen: %v %v", inserted, err)
	}
	if err := repository.CleanupReceipts(now.Add(-24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	var count int64
	repository.database.Model(&eventReceipt{}).Count(&count)
	if count != 16 {
		t.Fatalf("fresh receipts: %d", count)
	}
	if err := repository.CleanupReceipts(now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	repository.database.Model(&eventReceipt{}).Count(&count)
	if count != 0 {
		t.Fatalf("expired receipts: %d", count)
	}
	checkTotal()
}

func TestUsageIncrementFailureRollsBackReceipt(t *testing.T) {
	repository, err := Open(filepath.Join(t.TempDir(), "rollback.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	event := telemetry.Event{ID: "rollback-event-00001", Kind: "page_view", Mode: "setup"}
	if err := repository.database.Migrator().DropTable(&usageTotal{}); err != nil {
		t.Fatal(err)
	}
	inserted, err := repository.SaveEvent(context.Background(), event, time.Now())
	if err == nil || inserted {
		t.Fatal("failed increment was acknowledged")
	}
	var count int64
	if err := repository.database.Model(&eventReceipt{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("failed increment left a receipt")
	}
	if err := repository.database.AutoMigrate(&usageTotal{}); err != nil {
		t.Fatal(err)
	}
	inserted, err = repository.SaveEvent(context.Background(), event, time.Now())
	if err != nil || !inserted {
		t.Fatalf("retry failed: %v %v", inserted, err)
	}
	totals, err := repository.UsageTotals(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, total := range totals {
		if total.Kind == "page_view" && total.Mode == "setup" {
			if total.Value != 1 {
				t.Fatalf("total: %v", total)
			}
			return
		}
	}
	t.Fatal("missing page_view/setup total")
}

func TestCanceledUsageWriteLeavesNoReceipt(t *testing.T) {
	repository, err := Open(filepath.Join(t.TempDir(), "canceled.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	db, err := repository.database.DB()
	if err != nil {
		t.Fatal(err)
	}
	// Occupy the only connection so SaveEvent must wait for the pool.
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	event := telemetry.Event{ID: "canceled-event-00001", Kind: "page_view", Mode: "live"}
	done := make(chan error, 1)
	go func() {
		inserted, err := repository.SaveEvent(ctx, event, time.Now())
		if inserted {
			t.Error("canceled write was acknowledged")
		}
		done <- err
	}()
	deadline := time.Now().Add(time.Second)
	for db.Stats().WaitCount == 0 {
		if time.Now().After(deadline) {
			t.Fatal("write never queued for connection")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("got %v, want context cancellation", err)
		}
	case <-time.After(time.Second):
		t.Fatal("canceled write remained queued")
	}
	if err := connection.Close(); err != nil {
		t.Fatal(err)
	}
	// A retry with the same ID must still insert and increment once.
	inserted, err := repository.SaveEvent(context.Background(), event, time.Now())
	if err != nil || !inserted {
		t.Fatalf("retry failed: %v %v", inserted, err)
	}
	totals, err := repository.UsageTotals(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, total := range totals {
		if total.Kind == "page_view" && total.Mode == "live" && total.Value != 1 {
			t.Fatalf("total: %v", total)
		}
	}
}

func TestUsageTotalsDeadlineWhileConnectionBusy(t *testing.T) {
	repository, err := Open(filepath.Join(t.TempDir(), "read-timeout.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	db, err := repository.database.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := repository.UsageTotals(ctx)
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("got %v, want deadline exceeded", err)
		}
	case <-time.After(time.Second):
		t.Fatal("totals read remained queued after deadline")
	}
}
