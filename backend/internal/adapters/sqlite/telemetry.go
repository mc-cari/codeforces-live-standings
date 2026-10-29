package sqlite

import (
	"context"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/telemetry"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type usageTotal struct {
	Kind  string `gorm:"primaryKey"`
	Mode  string `gorm:"primaryKey"`
	Value int64  `gorm:"not null"`
}
type eventReceipt struct {
	ID         string `gorm:"primaryKey"`
	ReceivedAt int64  `gorm:"index;not null"`
}

// SaveEvent acknowledges only committed events, including ephemeral events whose
// receipts prevent retry deliveries from duplicating in-memory observations.
func (repository *Repository) SaveEvent(ctx context.Context, event telemetry.Event, now time.Time) (bool, error) {
	if err := event.Validate(); err != nil {
		return false, err
	}
	inserted := false
	err := repository.database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&eventReceipt{ID: event.ID, ReceivedAt: now.Unix()})
		if result.Error != nil {
			return result.Error
		}
		inserted = result.RowsAffected == 1
		if !inserted {
			return nil
		}
		if event.Kind == "loading_failed" {
			return nil
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "kind"}, {Name: "mode"}}, DoUpdates: clause.Assignments(map[string]any{"value": gorm.Expr("value + 1")})}).Create(&usageTotal{Kind: event.Kind, Mode: event.Mode, Value: 1}).Error
	})
	return inserted && err == nil, err
}

func (repository *Repository) UsageTotals(ctx context.Context) ([]telemetry.Total, error) {
	var records []usageTotal
	if err := repository.database.WithContext(ctx).Find(&records).Error; err != nil {
		return nil, err
	}
	totals := telemetry.KnownTotals()
	for i := range totals {
		for _, record := range records {
			if record.Kind == totals[i].Kind && record.Mode == totals[i].Mode {
				totals[i].Value = float64(record.Value)
			}
		}
	}
	return totals, nil
}

func (repository *Repository) CleanupReceipts(before time.Time) error {
	return repository.database.Where("received_at < ?", before.Unix()).Delete(&eventReceipt{}).Error
}
