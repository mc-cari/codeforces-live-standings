package livev3

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/application"
	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

type extension struct {
	Judging   json.RawMessage   `json:"judging,omitempty"`
	Instance  string            `json:"feed_instance"`
	Watermark string            `json:"watermark"`
	Fields    map[string]string `json:"custom_fields"`
}
type feedEvent struct {
	Type  string          `json:"type"`
	ID    string          `json:"id"`
	Token string          `json:"token"`
	Data  json.RawMessage `json:"data"`
	Live  extension       `json:"x_live"`
}
type boardProblem struct {
	ID      string   `json:"problem_id"`
	Judged  int      `json:"num_judged"`
	Pending int      `json:"num_pending"`
	Solved  bool     `json:"solved"`
	Score   *float64 `json:"score"`
	Time    string   `json:"time"`
}
type boardRow struct {
	Rank  int    `json:"rank"`
	Team  string `json:"team_id"`
	Score struct {
		Solved    int      `json:"num_solved"`
		Points    *float64 `json:"score"`
		TotalTime string   `json:"total_time"`
		Time      string   `json:"time"`
	} `json:"score"`
	Problems []boardProblem `json:"problems"`
}
type contestState struct {
	Started      string `json:"started"`
	Ended        string `json:"ended"`
	Finalized    string `json:"finalized"`
	EndOfUpdates string `json:"end_of_updates"`
	Frozen       string `json:"frozen"`
	Thawed       string `json:"thawed"`
}
type scoreboard struct {
	State *contestState `json:"state"`
	Rows  []boardRow    `json:"rows"`
	Live  extension     `json:"x_live"`
}

// Entity envelopes retain native metadata alongside their standard CLICS value.
type entity struct {
	Data json.RawMessage `json:"data"`
	Live extension       `json:"x_live"`
}

func applyEvent(entities map[string]map[string][]byte, event feedEvent) {
	if entities[event.Type] == nil {
		entities[event.Type] = make(map[string][]byte)
	}
	id := event.ID
	if id == "" {
		id = "contest"
	}
	if len(event.Data) == 0 || bytes.Equal(event.Data, []byte("null")) {
		delete(entities[event.Type], id)
		return
	}
	// An ordinary event following a metadata event must retain its metadata. The
	// exporter can emit both a metadata change and a standard entity change.
	live := event.Live
	live.Instance = ""
	live.Watermark = ""
	if live.Fields == nil {
		var old entity
		_ = json.Unmarshal(entities[event.Type][id], &old)
		live.Fields = old.Live.Fields
	}
	payload, _ := json.Marshal(entity{Data: event.Data, Live: live})
	if !bytes.Equal(entities[event.Type][id], payload) {
		entities[event.Type][id] = payload
	}
}
func seconds(value string) int {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0
	}
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	s, _ := strconv.ParseFloat(parts[2], 64)
	return h*3600 + m*60 + int(s)
}
func normalize(id int, entities map[string]map[string][]byte, board scoreboard) (application.ContestUpdate, error) {
	var native struct {
		Contest  domain.Contest   `json:"contest"`
		Problems []domain.Problem `json:"problems"`
	}
	if err := json.Unmarshal([]byte(board.Live.Fields["codeforces.standings"]), &native); err != nil {
		return application.ContestUpdate{}, fmt.Errorf("Codeforces contest metadata: %w", err)
	}
	if native.Contest.ID != id {
		return application.ContestUpdate{}, fmt.Errorf("unexpected contest ID %d", native.Contest.ID)
	}
	if state := board.State; state != nil {
		native.Contest.Frozen = state.Frozen != "" && state.Thawed == ""
		switch {
		case state.Finalized != "" || state.EndOfUpdates != "":
			native.Contest.Phase = "FINISHED"
		case state.Started == "":
			native.Contest.Phase = "BEFORE"
		case native.Contest.Phase == "FINISHED" && state.Ended == "":
			native.Contest.Phase = "SYSTEM_TEST"
		case native.Contest.Phase == "BEFORE":
			native.Contest.Phase = "CODING"
		}
	}
	standings := domain.Standings{Contest: native.Contest, Problems: native.Problems, Rows: make([]domain.RanklistRow, 0), Authoritative: true}
	teams := make(map[string]domain.Party)
	for key, payload := range entities["teams"] {
		var item entity
		if err := json.Unmarshal(payload, &item); err != nil {
			return application.ContestUpdate{}, err
		}
		var party domain.Party
		if raw := item.Live.Fields["codeforces.party"]; raw != "" {
			if err := json.Unmarshal([]byte(raw), &party); err != nil {
				return application.ContestUpdate{}, err
			}
		} else {
			continue
		}
		teams[key] = party
	}
	problemIDs := make(map[string]string)
	for key, payload := range entities["problems"] {
		var item entity
		var data struct {
			Label string `json:"label"`
		}
		_ = json.Unmarshal(payload, &item)
		_ = json.Unmarshal(item.Data, &data)
		problemIDs[key] = data.Label
	}
	for _, row := range board.Rows {
		party, ok := teams[row.Team]
		if !ok {
			return application.ContestUpdate{}, fmt.Errorf("scoreboard references unknown team %s", row.Team)
		}
		normalized := domain.RanklistRow{Party: party, Rank: row.Rank, Points: float64(row.Score.Solved), Penalty: seconds(row.Score.TotalTime) / 60, LastSubmissionTimeSecs: seconds(row.Score.Time), ProblemResults: make([]domain.ProblemResult, len(native.Problems))}
		if row.Score.Points != nil {
			normalized.Points = *row.Score.Points
		}
		for _, result := range row.Problems {
			for i, problem := range native.Problems {
				if problem.Index != problemIDs[result.ID] {
					continue
				}
				points := 0.0
				if result.Solved {
					points = 1
				}
				if result.Score != nil {
					points = *result.Score
				}
				wrong := result.Judged
				// CF accepts earn decayed positive points, so the CLICS `solved`
				// flag remains false even though this judged run was accepted.
				if result.Solved || (native.Contest.Type == "CF" && points > 0) {
					wrong--
				}
				kind := "FINAL"
				if result.Pending > 0 {
					kind = "PRELIMINARY"
				}
				normalized.ProblemResults[i] = domain.ProblemResult{Points: points, RejectedAttemptCount: max(0, wrong), Type: kind, BestSubmissionTimeSecs: seconds(result.Time)}
			}
		}
		standings.Rows = append(standings.Rows, normalized)
	}
	submissions := make(map[int]domain.Submission)
	for _, payload := range entities["submissions"] {
		var item entity
		_ = json.Unmarshal(payload, &item)
		raw := item.Live.Fields["codeforces.submission"]
		if raw == "" {
			continue
		}
		var submission domain.Submission
		if err := json.Unmarshal([]byte(raw), &submission); err != nil {
			return application.ContestUpdate{}, err
		}
		submissions[submission.ID] = submission
	}
	// Maps are copied because the feed continues staging while SQLite and browsers
	// retain this immutable version.
	retained := make(map[string]map[string][]byte, len(entities))
	for resource, values := range entities {
		retained[resource] = make(map[string][]byte, len(values))
		for key, data := range values {
			retained[resource][key] = data
		}
	}
	return application.ContestUpdate{Standings: standings, Submissions: submissions, Entities: retained, Finished: native.Contest.Phase == "FINISHED"}, nil
}
