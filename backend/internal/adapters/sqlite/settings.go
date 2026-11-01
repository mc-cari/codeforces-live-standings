package sqlite

import (
	"encoding/json"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"gorm.io/gorm/clause"
)

type collectionSettingsRecord struct {
	ID      int    `gorm:"primaryKey"`
	Payload []byte `gorm:"not null"`
}

func (r *Repository) LoadCollectionSettings() (application.CollectionSettings, error) {
	var rows []collectionSettingsRecord
	if err := r.database.Where("id = ?", 1).Find(&rows).Error; err != nil {
		return application.CollectionSettings{}, err
	}
	settings := application.DefaultCollectionSettings()
	if len(rows) > 0 {
		if err := json.Unmarshal(rows[0].Payload, &settings); err != nil {
			return settings, err
		}
	}
	return settings, nil
}
func (r *Repository) SaveCollectionSettings(settings application.CollectionSettings) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	return r.database.Clauses(clause.OnConflict{UpdateAll: true}).Create(&collectionSettingsRecord{ID: 1, Payload: payload}).Error
}
