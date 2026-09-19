package domain

type Contest struct {
	ID                  int    `json:"id"`
	Name                string `json:"name"`
	Type                string `json:"type"`
	Phase               string `json:"phase"`
	Frozen              bool   `json:"frozen"`
	DurationSeconds     int64  `json:"durationSeconds"`
	StartTimeSeconds    int64  `json:"startTimeSeconds"`
	RelativeTimeSeconds int64  `json:"relativeTimeSeconds"`
}

type Member struct {
	Handle string `json:"handle"`
	Name   string `json:"name,omitempty"`
}

type Party struct {
	ContestID       int      `json:"contestId,omitempty"`
	Members         []Member `json:"members"`
	ParticipantType string   `json:"participantType"`
	TeamID          int      `json:"teamId,omitempty"`
	TeamName        string   `json:"teamName,omitempty"`
	Ghost           bool     `json:"ghost,omitempty"`
	Rank            int      `json:"rank,omitempty"`
}

type Problem struct {
	ContestID      int      `json:"contestId,omitempty"`
	ProblemsetName string   `json:"problemsetName,omitempty"`
	Index          string   `json:"index"`
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	Points         float64  `json:"points,omitempty"`
	Rating         int      `json:"rating,omitempty"`
	Tags           []string `json:"tags,omitempty"`
}

type ProblemResult struct {
	Points                 float64 `json:"points"`
	Penalty                int     `json:"penalty"`
	RejectedAttemptCount   int     `json:"rejectedAttemptCount"`
	Type                   string  `json:"type"`
	BestSubmissionTimeSecs int     `json:"bestSubmissionTimeSeconds"`
}

type RanklistRow struct {
	Party                  Party           `json:"party"`
	Rank                   int             `json:"rank"`
	Points                 float64         `json:"points"`
	Penalty                int             `json:"penalty"`
	SuccessfulHackCount    int             `json:"successfulHackCount"`
	UnsuccessfulHackCount  int             `json:"unsuccessfulHackCount"`
	ProblemResults         []ProblemResult `json:"problemResults"`
	LastSubmissionTimeSecs int             `json:"lastSubmissionTimeSeconds"`
}

type Standings struct {
	Contest  Contest       `json:"contest"`
	Problems []Problem     `json:"problems"`
	Rows     []RanklistRow `json:"rows"`
}

type Submission struct {
	ID                  int     `json:"id"`
	ContestID           int     `json:"contestId"`
	CreationTimeSeconds int64   `json:"creationTimeSeconds"`
	RelativeTimeSeconds int64   `json:"relativeTimeSeconds"`
	Problem             Problem `json:"problem"`
	Author              Party   `json:"author"`
	ProgrammingLanguage string  `json:"programmingLanguage"`
	Verdict             string  `json:"verdict"`
	Testset             string  `json:"testset"`
	PassedTestCount     int     `json:"passedTestCount"`
	TimeConsumedMillis  int     `json:"timeConsumedMillis"`
	MemoryConsumedBytes int64   `json:"memoryConsumedBytes"`
	Points              float64 `json:"points,omitempty"`
	NumberOfProblems    int     `json:"numberOfProblems,omitempty"`
}
