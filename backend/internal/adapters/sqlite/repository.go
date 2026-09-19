package sqlite

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
	_ "modernc.org/sqlite"
)

type Repository struct{ database *sql.DB }

func Open(path string) (*Repository, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)
	for _, pragma := range []string{"PRAGMA journal_mode=WAL", "PRAGMA synchronous=FULL", "PRAGMA foreign_keys=ON", "PRAGMA busy_timeout=5000", "PRAGMA cache_size=-32768"} {
		if _, err := database.Exec(pragma); err != nil {
			database.Close()
			return nil, err
		}
	}
	_, err = database.Exec(`
		CREATE TABLE IF NOT EXISTS contests (
			id INTEGER PRIMARY KEY, phase TEXT NOT NULL, contest_json BLOB NOT NULL,
			activated_at INTEGER NOT NULL, finished_at INTEGER, revision INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS submissions (
			contest_id INTEGER NOT NULL, id INTEGER NOT NULL, payload BLOB NOT NULL, payload_hash TEXT NOT NULL,
			PRIMARY KEY (contest_id, id), FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE CASCADE
		);`)
	if err != nil {
		database.Close()
		return nil, err
	}
	return &Repository{database: database}, nil
}

func (repository *Repository) Close() error { return repository.database.Close() }

func (repository *Repository) SaveContest(contest domain.Contest, activatedAt time.Time) error {
	payload, err := json.Marshal(contest)
	if err != nil {
		return err
	}
	_, err = repository.database.Exec(`INSERT INTO contests(id,phase,contest_json,activated_at) VALUES(?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,contest_json=excluded.contest_json`, contest.ID, contest.Phase, payload, activatedAt.Unix())
	return err
}

func (repository *Repository) LoadActive() ([]application.StoredContest, error) {
	rows, err := repository.database.Query(`SELECT contest_json,revision FROM contests WHERE finished_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var records []application.StoredContest
	for rows.Next() {
		var payload []byte
		var record application.StoredContest
		if err := rows.Scan(&payload, &record.Revision); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &record.Contest); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (repository *Repository) LoadSubmissions(contestID int) (map[int]domain.Submission, error) {
	rows, err := repository.database.Query(`SELECT id,payload FROM submissions WHERE contest_id=?`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[int]domain.Submission)
	for rows.Next() {
		var id int
		var payload []byte
		var submission domain.Submission
		if err := rows.Scan(&id, &payload); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &submission); err != nil {
			return nil, err
		}
		result[id] = submission
	}
	return result, rows.Err()
}

func (repository *Repository) SaveSubmissions(contestID int, submissions []domain.Submission) (int, error) {
	if len(submissions) == 0 {
		return 0, nil
	}
	transaction, err := repository.database.Begin()
	if err != nil {
		return 0, err
	}
	defer transaction.Rollback()
	statement, err := transaction.Prepare(`INSERT INTO submissions(contest_id,id,payload,payload_hash) VALUES(?,?,?,?)
		ON CONFLICT(contest_id,id) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash
		WHERE submissions.payload_hash <> excluded.payload_hash`)
	if err != nil {
		return 0, err
	}
	defer statement.Close()
	changed := 0
	for _, submission := range submissions {
		payload, err := json.Marshal(submission)
		if err != nil {
			return 0, err
		}
		sum := sha256.Sum256(payload)
		result, err := statement.Exec(contestID, submission.ID, payload, hex.EncodeToString(sum[:]))
		if err != nil {
			return 0, err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		changed += int(rows)
	}
	if err := transaction.Commit(); err != nil {
		return 0, err
	}
	return changed, nil
}

func (repository *Repository) BumpRevision(contestID int, phase string, finished bool, now time.Time) (int64, error) {
	var result sql.Result
	var err error
	if finished {
		result, err = repository.database.Exec(`UPDATE contests SET revision=revision+1,phase=?,finished_at=? WHERE id=?`, phase, now.Unix(), contestID)
	} else {
		result, err = repository.database.Exec(`UPDATE contests SET revision=revision+1,phase=? WHERE id=?`, phase, contestID)
	}
	if err != nil {
		return 0, err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return 0, errors.New("revision update failed")
	}
	var revision int64
	err = repository.database.QueryRow(`SELECT revision FROM contests WHERE id=?`, contestID).Scan(&revision)
	return revision, err
}

func (repository *Repository) CleanupExpired(before time.Time) error {
	_, err := repository.database.Exec(`DELETE FROM contests WHERE finished_at IS NOT NULL AND finished_at < ?`, before.Unix())
	return err
}
