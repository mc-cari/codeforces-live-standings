package application

import (
	"context"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type StoredContest struct {
	Contest  domain.Contest
	Revision int64
}

type Repository interface {
	SaveContest(domain.Contest, time.Time) error
	LoadActive() ([]StoredContest, error)
	LoadSubmissions(int) (map[int]domain.Submission, error)
	SaveSubmissions(int, []domain.Submission) (int, error)
	BumpRevision(int, string, bool, time.Time) (int64, error)
	CleanupExpired(time.Time) error
}

type ContestGateway interface {
	FetchSubmissions(context.Context, int) ([]domain.Submission, error)
	FetchStandings(context.Context, int) (domain.Standings, error)
}
