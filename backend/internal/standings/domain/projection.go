package domain

import (
	"sort"
	"strings"
)

type HandleSet map[string]struct{}

func NewHandleSet(handles []string) HandleSet {
	set := make(HandleSet, len(handles))
	for _, handle := range handles {
		set[strings.ToLower(handle)] = struct{}{}
	}
	return set
}

func (set HandleSet) Selects(party Party) bool {
	for _, member := range party.Members {
		if _, ok := set[strings.ToLower(member.Handle)]; ok {
			return true
		}
	}
	return false
}

func Project(contest Contest, source *Standings, all map[int]Submission, handles HandleSet) (Standings, []Submission) {
	standings := Standings{Contest: contest}
	if source != nil {
		standings = *source
		standings.Rows = nil
		for _, row := range source.Rows {
			if handles.Selects(row.Party) {
				standings.Rows = append(standings.Rows, row)
			}
		}
		addMissingRows(&standings, all, handles)
	}
	return standings, decorateSubmissions(all, handles, standings)
}

func decorateSubmissions(all map[int]Submission, handles HandleSet, standings Standings) []Submission {
	positions := make(map[string]int)
	previousPoints, previousPosition := -1.0, 0
	previousPenalty := -1
	for index, row := range standings.Rows {
		position := index + 1
		if row.Points == previousPoints && row.Penalty == previousPenalty {
			position = previousPosition
		}
		positions[PartyName(row.Party)] = position
		previousPoints, previousPenalty, previousPosition = row.Points, row.Penalty, position
	}

	result := make([]Submission, 0)
	for _, submission := range all {
		if handles.Selects(submission.Author) {
			copy := submission
			copy.Author.Rank = positions[PartyName(copy.Author)]
			result = append(result, copy)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].RelativeTimeSeconds != result[j].RelativeTimeSeconds {
			return result[i].RelativeTimeSeconds < result[j].RelativeTimeSeconds
		}
		return result[i].ID < result[j].ID
	})
	solved := make(map[string]map[string]bool)
	for index := range result {
		name := PartyName(result[index].Author)
		if solved[name] == nil {
			solved[name] = make(map[string]bool)
		}
		if result[index].Verdict == "OK" {
			solved[name][result[index].Problem.Index] = true
		}
		result[index].NumberOfProblems = len(solved[name])
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].RelativeTimeSeconds != result[j].RelativeTimeSeconds {
			return result[i].RelativeTimeSeconds > result[j].RelativeTimeSeconds
		}
		return result[i].ID > result[j].ID
	})
	if len(result) > 10000 {
		result = result[:10000]
	}
	return result
}

func PartyName(party Party) string {
	name := party.TeamName
	if name == "" && len(party.Members) > 0 {
		name = party.Members[0].Handle
	}
	if party.ParticipantType == "PRACTICE" {
		name += " (practice)"
	}
	return name
}

func addMissingRows(standings *Standings, all map[int]Submission, handles HandleSet) {
	existing := make(map[string]bool, len(standings.Rows))
	for _, row := range standings.Rows {
		existing[PartyName(row.Party)] = true
	}
	submissions := make([]Submission, 0, len(all))
	for _, submission := range all {
		if handles.Selects(submission.Author) && submission.RelativeTimeSeconds >= 0 && submission.RelativeTimeSeconds <= standings.Contest.DurationSeconds {
			submissions = append(submissions, submission)
		}
	}
	sort.Slice(submissions, func(i, j int) bool {
		if submissions[i].RelativeTimeSeconds != submissions[j].RelativeTimeSeconds {
			return submissions[i].RelativeTimeSeconds < submissions[j].RelativeTimeSeconds
		}
		return submissions[i].ID < submissions[j].ID
	})
	problemIndex := make(map[string]int, len(standings.Problems))
	for index, problem := range standings.Problems {
		problemIndex[problem.Index] = index
	}
	missing := make(map[string]*RanklistRow)
	solved := make(map[string]map[string]bool)
	for _, submission := range submissions {
		name := PartyName(submission.Author)
		if existing[name] {
			continue
		}
		index, ok := problemIndex[submission.Problem.Index]
		if !ok {
			continue
		}
		row := missing[name]
		if row == nil {
			row = &RanklistRow{Party: submission.Author, ProblemResults: make([]ProblemResult, len(standings.Problems))}
			missing[name] = row
			solved[name] = make(map[string]bool)
		}
		row.LastSubmissionTimeSecs = max(row.LastSubmissionTimeSecs, int(submission.RelativeTimeSeconds))
		result := &row.ProblemResults[index]
		if submission.Verdict == "OK" {
			if standings.Contest.Type == "ICPC" {
				if solved[name][submission.Problem.Index] {
					continue
				}
				solved[name][submission.Problem.Index] = true
				result.Points = 1
				result.BestSubmissionTimeSecs = int(submission.RelativeTimeSeconds)
				result.Penalty = int(submission.RelativeTimeSeconds/60) + result.RejectedAttemptCount*20
				row.Points++
				row.Penalty += result.Penalty
				continue
			}
			points := submission.Points
			if points <= 0 {
				points = max(0.3*standings.Problems[index].Points, standings.Problems[index].Points-(standings.Problems[index].Points*float64(submission.RelativeTimeSeconds/60)/250)-50*float64(result.RejectedAttemptCount))
			}
			if points > result.Points {
				row.Points += points - result.Points
				result.Points = points
				result.BestSubmissionTimeSecs = int(submission.RelativeTimeSeconds)
			}
		} else if !solved[name][submission.Problem.Index] && penalized(submission.Verdict) {
			result.RejectedAttemptCount++
		}
	}
	for _, row := range missing {
		standings.Rows = append(standings.Rows, *row)
	}
	sort.SliceStable(standings.Rows, func(i, j int) bool {
		if standings.Rows[i].Points != standings.Rows[j].Points {
			return standings.Rows[i].Points > standings.Rows[j].Points
		}
		return standings.Rows[i].Penalty < standings.Rows[j].Penalty
	})
}

func penalized(verdict string) bool {
	switch verdict {
	case "OK", "COMPILATION_ERROR", "SKIPPED", "TESTING":
		return false
	default:
		return true
	}
}
