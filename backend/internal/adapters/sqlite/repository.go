package sqlite

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type contestRecord struct {
	ID          int    `gorm:"primaryKey;column:id"`
	Phase       string `gorm:"not null"`
	ContestJSON []byte `gorm:"column:contest_json;not null"`
	ActivatedAt int64  `gorm:"not null"`
	FinishedAt  *int64
	Revision    int64 `gorm:"not null;default:0"`
}

func (contestRecord) TableName() string { return "contests" }

type submissionRecord struct {
	ContestID   int            `gorm:"primaryKey;column:contest_id"`
	ID          int            `gorm:"primaryKey;column:id"`
	Payload     []byte         `gorm:"not null"`
	PayloadHash string         `gorm:"not null"`
	Contest     *contestRecord `gorm:"foreignKey:ContestID;references:ID;constraint:OnDelete:CASCADE"`
}

func (submissionRecord) TableName() string { return "submissions" }

type Repository struct {
	database *gorm.DB
}

func Open(path string) (*Repository, error) {
	database, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		return nil, err
	}
	sqlDatabase.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA synchronous=FULL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
		"PRAGMA cache_size=-32768",
	} {
		if err := database.Exec(pragma).Error; err != nil {
			_ = sqlDatabase.Close()
			return nil, err
		}
	}
	if err := database.AutoMigrate(&contestRecord{}, &submissionRecord{}); err != nil {
		_ = sqlDatabase.Close()
		return nil, err
	}
	return &Repository{database: database}, nil
}

func (repository *Repository) Close() error {
	database, err := repository.database.DB()
	if err != nil {
		return err
	}
	return database.Close()
}

func (repository *Repository) SaveContest(contest domain.Contest, activatedAt time.Time) error {
	payload, err := json.Marshal(contest)
	if err != nil {
		return err
	}
	record := contestRecord{
		ID:          contest.ID,
		Phase:       contest.Phase,
		ContestJSON: payload,
		ActivatedAt: activatedAt.Unix(),
	}
	return repository.database.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"phase", "contest_json",
		}),
	}).Create(&record).Error
}

func (repository *Repository) LoadActive() ([]application.StoredContest, error) {
	var records []contestRecord
	if err := repository.database.Where("finished_at IS NULL").Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]application.StoredContest, 0, len(records))
	for _, record := range records {
		var contest domain.Contest
		if err := json.Unmarshal(record.ContestJSON, &contest); err != nil {
			return nil, err
		}
		result = append(result, application.StoredContest{Contest: contest, Revision: record.Revision})
	}
	return result, nil
}

func (repository *Repository) LoadSubmissions(contestID int) (map[int]domain.Submission, error) {
	var records []submissionRecord
	if err := repository.database.Where("contest_id = ?", contestID).Find(&records).Error; err != nil {
		return nil, err
	}
	result := make(map[int]domain.Submission, len(records))
	for _, record := range records {
		var submission domain.Submission
		if err := json.Unmarshal(record.Payload, &submission); err != nil {
			return nil, err
		}
		result[record.ID] = submission
	}
	return result, nil
}

func (repository *Repository) SaveSubmissions(contestID int, submissions []domain.Submission) (int, error) {
	if len(submissions) == 0 {
		return 0, nil
	}
	changed := 0
	err := repository.database.Transaction(func(transaction *gorm.DB) error {
		for _, submission := range submissions {
			payload, err := json.Marshal(submission)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(payload)
			hash := hex.EncodeToString(sum[:])

			var existing submissionRecord
			err = transaction.Where("contest_id = ? AND id = ?", contestID, submission.ID).First(&existing).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				err = transaction.Create(&submissionRecord{
					ContestID: contestID, ID: submission.ID, Payload: payload, PayloadHash: hash,
				}).Error
				if err == nil {
					changed++
				}
			case err != nil:
			default:
				if existing.PayloadHash == hash {
					continue
				}
				err = transaction.Model(&submissionRecord{}).
					Where("contest_id = ? AND id = ?", contestID, submission.ID).
					Updates(map[string]any{"payload": payload, "payload_hash": hash}).Error
				if err == nil {
					changed++
				}
			}
			if err != nil {
				return err
			}
		}
		return nil
	})
	return changed, err
}

func (repository *Repository) BumpRevision(contestID int, phase string, finished bool, now time.Time) (int64, error) {
	updates := map[string]any{
		"revision": gorm.Expr("revision + 1"),
		"phase":    phase,
	}
	if finished {
		updates["finished_at"] = now.Unix()
	}
	result := repository.database.Model(&contestRecord{}).Where("id = ?", contestID).Updates(updates)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, errors.New("revision update failed")
	}
	var record contestRecord
	if err := repository.database.Select("revision").First(&record, contestID).Error; err != nil {
		return 0, err
	}
	return record.Revision, nil
}

func (repository *Repository) CleanupExpired(before time.Time) error {
	return repository.database.Where("finished_at IS NOT NULL AND finished_at < ?", before.Unix()).Delete(&contestRecord{}).Error
}
