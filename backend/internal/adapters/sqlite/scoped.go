package sqlite

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type sourceView struct {
	Source     string `gorm:"primaryKey"`
	ContestID  int    `gorm:"primaryKey;autoIncrement:false"`
	Payload    []byte
	Revision   int64
	FinishedAt *int64
	UpdatedAt  int64 `gorm:"autoUpdateTime:false"`
}
type sourceMigration struct {
	Source string `gorm:"primaryKey"`
}

type sourceEntity struct {
	Source    string `gorm:"primaryKey"`
	ContestID int    `gorm:"primaryKey;autoIncrement:false"`
	Resource  string `gorm:"primaryKey"`
	EntityID  string `gorm:"primaryKey"`
	Payload   []byte
}

// Scoped keeps all provider records isolated in the same SQLite database.
type Scoped struct {
	repository *Repository
	source     string
}

func (r *Repository) Scope(source string) (*Scoped, error) {
	if source != "codeforces" && source != "livev3" {
		return nil, errors.New("unknown contest source")
	}
	if err := r.database.AutoMigrate(&sourceView{}, &sourceEntity{}, &sourceMigration{}); err != nil {
		return nil, err
	}
	scoped := &Scoped{r, source}
	var migrated int64
	if err := r.database.Model(&sourceMigration{}).Where("source = ?", source).Count(&migrated).Error; err != nil {
		return nil, err
	}
	if source == "codeforces" && migrated == 0 {
		var legacy []contestRecord
		if err := r.database.Find(&legacy).Error; err != nil {
			return nil, err
		}
		for _, row := range legacy {
			var count int64
			if err := r.database.Model(&sourceView{}).Where("source = ? AND contest_id = ?", source, row.ID).Count(&count).Error; err != nil {
				return nil, err
			}
			if count != 0 {
				continue
			}
			var contest domain.Contest
			if err := json.Unmarshal(row.ContestJSON, &contest); err != nil {
				return nil, err
			}
			submissions, err := r.LoadSubmissions(row.ID)
			if err != nil {
				return nil, err
			}
			view := application.ContestUpdate{Standings: domain.Standings{Contest: contest}, Submissions: submissions, Finished: row.FinishedAt != nil}
			if err := scoped.SaveView(row.ID, view, row.Revision); err != nil {
				return nil, err
			}
			if row.FinishedAt != nil {
				if err := r.database.Model(&sourceView{}).Where("source = ? AND contest_id = ?", source, row.ID).Update("finished_at", row.FinishedAt).Error; err != nil {
					return nil, err
				}
			}
		}
	}
	if err := r.database.Clauses(clause.OnConflict{DoNothing: true}).Create(&sourceMigration{Source: source}).Error; err != nil {
		return nil, err
	}
	return scoped, nil
}
func (r *Scoped) record(id int) (sourceView, error) {
	var row sourceView
	result := r.repository.database.Where("source = ? AND contest_id = ?", r.source, id).Limit(1).Find(&row)
	if result.Error != nil {
		return row, result.Error
	}
	if result.RowsAffected == 0 {
		return row, gorm.ErrRecordNotFound
	}
	return row, nil
}
func (r *Scoped) LoadView(id int) (*application.ContestUpdate, error) {
	row, err := r.record(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var view application.ContestUpdate
	if err := json.Unmarshal(row.Payload, &view); err != nil {
		return nil, err
	}
	view.Standings.Authoritative = r.source == "livev3"
	if view.Submissions == nil {
		view.Submissions = make(map[int]domain.Submission)
	}
	return &view, nil
}
func (r *Scoped) SaveView(id int, view application.ContestUpdate, revision int64) error {
	payload, err := json.Marshal(view)
	if err != nil {
		return err
	}
	row := sourceView{Source: r.source, ContestID: id, Payload: payload, Revision: revision, UpdatedAt: time.Now().Unix()}
	if view.Finished {
		now := time.Now().Unix()
		row.FinishedAt = &now
	}
	return r.repository.database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&row).Error; err != nil {
			return err
		}
		// The complete retained entity set includes explicit deletions already applied.
		var existing []sourceEntity
		if err := tx.Where("source = ? AND contest_id = ?", r.source, id).Find(&existing).Error; err != nil {
			return err
		}
		oldPayloads := make(map[string]map[string][]byte)
		for _, old := range existing {
			if oldPayloads[old.Resource] == nil {
				oldPayloads[old.Resource] = make(map[string][]byte)
			}
			oldPayloads[old.Resource][old.EntityID] = old.Payload
		}
		for _, old := range existing {
			if _, ok := view.Entities[old.Resource][old.EntityID]; !ok {
				if err := tx.Delete(&old).Error; err != nil {
					return err
				}
			}
		}
		for resource, entities := range view.Entities {
			for id, data := range entities {
				if bytes.Equal(oldPayloads[resource][id], data) {
					continue
				}
				entity := sourceEntity{Source: r.source, ContestID: row.ContestID, Resource: resource, EntityID: id, Payload: data}
				if err := tx.Clauses(clause.OnConflict{DoUpdates: clause.AssignmentColumns([]string{"payload"}), Where: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "payload <> excluded.payload"}}}}).Create(&entity).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
func (r *Scoped) SaveContest(contest domain.Contest, now time.Time) error {
	view, err := r.LoadView(contest.ID)
	if err != nil {
		return err
	}
	if view == nil {
		view = &application.ContestUpdate{Submissions: make(map[int]domain.Submission)}
	}
	view.Standings.Contest = contest
	row, _ := r.record(contest.ID)
	return r.SaveView(contest.ID, *view, row.Revision)
}
func (r *Scoped) LoadActive() ([]application.StoredContest, error) {
	var rows []sourceView
	if err := r.repository.database.Where("source = ?", r.source).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]application.StoredContest, 0, len(rows))
	for _, row := range rows {
		var view application.ContestUpdate
		if err := json.Unmarshal(row.Payload, &view); err != nil {
			return nil, err
		}
		var finishedAt *time.Time
		if row.FinishedAt != nil {
			value := time.Unix(*row.FinishedAt, 0)
			finishedAt = &value
		}
		result = append(result, application.StoredContest{Contest: view.Standings.Contest, Revision: row.Revision, FinishedAt: finishedAt})
	}
	return result, nil
}
func (r *Scoped) LoadSubmissions(id int) (map[int]domain.Submission, error) {
	view, err := r.LoadView(id)
	if err != nil {
		return nil, err
	}
	if view == nil {
		return make(map[int]domain.Submission), nil
	}
	return view.Submissions, nil
}
func (r *Scoped) SaveSubmissions(id int, submissions []domain.Submission) (int, error) {
	view, err := r.LoadView(id)
	if err != nil {
		return 0, err
	}
	if view == nil {
		return 0, errors.New("contest missing")
	}
	changed := 0
	for _, item := range submissions {
		old, _ := json.Marshal(view.Submissions[item.ID])
		next, _ := json.Marshal(item)
		if string(old) != string(next) {
			changed++
			view.Submissions[item.ID] = item
		}
	}
	row, err := r.record(id)
	if err != nil {
		return 0, err
	}
	return changed, r.SaveView(id, *view, row.Revision)
}
func (r *Scoped) BumpRevision(id int, phase string, finished bool, now time.Time) (int64, error) {
	// Completion is committed together with the full view by SaveView.
	row, err := r.record(id)
	if err != nil {
		return 0, err
	}
	return row.Revision + 1, nil
}
func (r *Scoped) CleanupExpired(before time.Time) error {
	return r.repository.database.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("source = ? AND finished_at < ?", r.source, before.Unix())
		if err := tx.Where("source = ? AND contest_id IN (?)", r.source, query.Model(&sourceView{}).Select("contest_id")).Delete(&sourceEntity{}).Error; err != nil {
			return err
		}
		return tx.Where("source = ? AND finished_at < ?", r.source, before.Unix()).Delete(&sourceView{}).Error
	})
}
