package application

import (
	"context"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type StoredContest struct {
	FinishedAt *time.Time
	Contest    domain.Contest
	Revision   int64
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

// SubmissionHistoryObserver records successful upstream responses compared with
// submissions already retained locally. It receives no contest or participant IDs.
type SubmissionHistoryObserver interface {
	ObserveSubmissionHistory(missing int)
}

// ContestUpdate is a coherent, complete application view from a source. Entities
// contain the retained, normalized source objects, keyed by resource and ID.
type ContestUpdate struct {
	Standings   domain.Standings
	Submissions map[int]domain.Submission
	Entities    map[string]map[string][]byte
	Finished    bool
}

// StreamingGateway supplies authoritative views. Errors retain the last view.
type StreamingGateway interface {
	Stream(context.Context, int, func(ContestUpdate) error) error
	StopContest(int)
}

type ViewRepository interface {
	LoadView(int) (*ContestUpdate, error)
	SaveView(int, ContestUpdate, int64) error
}

// ContestSource initializes the same complete view for polling and streaming adapters.
type ContestSource interface {
	InitialUpdate(context.Context, int) (ContestUpdate, error)
}
