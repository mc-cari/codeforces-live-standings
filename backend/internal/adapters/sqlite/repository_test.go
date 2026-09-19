package sqlite

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

func TestRepositoryPersistsOnlyChangedSubmissions(t *testing.T) {
	repository, err := Open(filepath.Join(t.TempDir(), "live.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer repository.Close()
	if err := repository.SaveContest(domain.Contest{ID: 1, Phase: "CODING", Name: "test"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	submission := domain.Submission{ID: 10, ContestID: 1, Verdict: "TESTING", Author: domain.Party{Members: []domain.Member{{Handle: "tourist"}}}}
	changed, err := repository.SaveSubmissions(1, []domain.Submission{submission})
	if err != nil || changed != 1 {
		t.Fatalf("first write: changed=%d err=%v", changed, err)
	}
	changed, err = repository.SaveSubmissions(1, []domain.Submission{submission})
	if err != nil || changed != 0 {
		t.Fatalf("unchanged write: changed=%d err=%v", changed, err)
	}
	submission.Verdict = "OK"
	changed, err = repository.SaveSubmissions(1, []domain.Submission{submission})
	if err != nil || changed != 1 {
		t.Fatalf("updated write: changed=%d err=%v", changed, err)
	}
	loaded, err := repository.LoadSubmissions(1)
	if err != nil || loaded[10].Verdict != "OK" {
		t.Fatalf("loaded submission: %#v err=%v", loaded[10], err)
	}
}
