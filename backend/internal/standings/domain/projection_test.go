package domain

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"testing"
)

func TestProjectionFiltersAnyTeamMember(t *testing.T) {
	contest := Contest{ID: 1}
	standings := &Standings{Contest: contest}
	_, submissions := Project(contest, standings, map[int]Submission{
		1: {ID: 1, Author: Party{Members: []Member{{Handle: "alpha"}, {Handle: "beta"}}}},
		2: {ID: 2, Author: Party{Members: []Member{{Handle: "other"}}}},
	}, NewHandleSet([]string{"beta"}))
	if len(submissions) != 1 || submissions[0].ID != 1 {
		t.Fatalf("unexpected submissions: %#v", submissions)
	}
}

func TestTeamSelectionThroughEitherMemberProjectsOneTeamAndUniqueRuns(t *testing.T) {
	team := Party{TeamID: 77, TeamName: "team", ParticipantType: "CONTESTANT", Members: []Member{{Handle: "Alpha"}, {Handle: "Beta"}}}
	rows := []RanklistRow{{Party: team, Rank: 1, Points: 7}}
	all := map[int]Submission{
		11: {ID: 11, Author: team, Verdict: "WRONG_ANSWER"},
		12: {ID: 12, Author: team, Verdict: "OK"},
		13: {ID: 13, Author: Party{Members: []Member{{Handle: "other"}}}},
	}
	for _, handles := range [][]string{{"beta"}, {"alpha", "beta"}} {
		projected, runs := Project(Contest{}, &Standings{Rows: rows, Authoritative: true}, all, NewHandleSet(handles))
		if len(projected.Rows) != 1 || len(runs) != 2 || runs[0].ID == runs[1].ID {
			t.Fatalf("handles %v produced rows=%d runs=%#v", handles, len(projected.Rows), runs)
		}
	}
}

func TestCapturedTeamHistoriesPreserveDirectProviderOracleForEitherMember(t *testing.T) {
	type capture struct {
		Contest  Contest       `json:"contest"`
		Problems []Problem     `json:"problems"`
		Rows     []RanklistRow `json:"selectedOfficialRows"`
		Teams    map[string]struct {
			Submissions []Submission `json:"submissions"`
		} `json:"selectedTeams"`
	}
	for _, contestID := range []int{639, 640} {
		raw, err := os.ReadFile("../../../../docs/reviews/evidence/live-v3-commit-review/team-replay/contest-" + strconv.Itoa(contestID) + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var data capture
		if err := json.Unmarshal(raw, &data); err != nil {
			t.Fatal(err)
		}
		source := Standings{Contest: data.Contest, Problems: data.Problems, Rows: data.Rows, Authoritative: true}
		for teamID, team := range data.Teams {
			if teamID == "18211" {
				continue
			}
			party := team.Submissions[0].Author
			if len(party.Members) == 0 {
				t.Fatalf("contest %d team %s has no members", contestID, teamID)
			}
			all := make(map[int]Submission, len(team.Submissions))
			for _, submission := range team.Submissions {
				all[submission.ID] = submission
			}
			members := make([]string, len(party.Members))
			for i, member := range party.Members {
				members[i] = member.Handle
			}
			selections := [][]string{members[len(members)-1:], members}
			for _, handles := range selections {
				projected, runs := Project(data.Contest, &source, all, NewHandleSet(handles))
				var apiRow RanklistRow
				for _, row := range source.Rows {
					if row.Party.TeamID == party.TeamID {
						apiRow = row
						break
					}
				}
				if len(projected.Rows) != 1 || projected.Rows[0].Rank != apiRow.Rank || projected.Rows[0].Points != apiRow.Points || projected.Rows[0].Penalty != apiRow.Penalty || !reflect.DeepEqual(projected.Rows[0].ProblemResults, apiRow.ProblemResults) {
					t.Fatalf("contest %d team %s changed API score row for handles %v: %#v", contestID, teamID, handles, projected.Rows)
				}
				if len(runs) != len(team.Submissions) {
					t.Fatalf("contest %d team %s duplicated or lost runs: got %d want %d", contestID, teamID, len(runs), len(team.Submissions))
				}
			}
		}
	}
}

func TestProjectionReconstructsMissingParticipantRow(t *testing.T) {
	contest := Contest{ID: 1, Phase: "CODING", Type: "CF", DurationSeconds: 7200}
	standings := &Standings{Contest: contest, Problems: []Problem{{Index: "A", Points: 500}}}
	projected, _ := Project(contest, standings, map[int]Submission{
		1: {ID: 1, RelativeTimeSeconds: 600, Verdict: "OK", Points: 500, Problem: Problem{Index: "A", Points: 500}, Author: Party{Members: []Member{{Handle: "tourist"}}, ParticipantType: "CONTESTANT"}},
	}, NewHandleSet([]string{"tourist"}))
	if len(projected.Rows) != 1 || projected.Rows[0].Party.Members[0].Handle != "tourist" || projected.Rows[0].Points != 500 {
		t.Fatalf("unexpected reconstructed rows: %#v", projected.Rows)
	}
}

func TestAuthoritativeProjectionPreservesEngineTiesAndDoesNotInventRows(t *testing.T) {
	party := func(handle string) Party { return Party{Members: []Member{{Handle: handle}}} }
	source := Standings{Authoritative: true, Rows: []RanklistRow{{Party: party("a"), Rank: 2, Points: 500}, {Party: party("b"), Rank: 3, Points: 500}, {Party: party("c"), Rank: 3, Points: 500}}}
	all := map[int]Submission{1: {ID: 1, Author: party("a")}, 2: {ID: 2, Author: party("b")}, 3: {ID: 3, Author: party("c")}, 4: {ID: 4, Author: party("missing"), Verdict: "OK"}}
	view, submissions := Project(Contest{}, &source, all, NewHandleSet([]string{"a", "b", "c", "missing"}))
	if len(view.Rows) != 3 {
		t.Fatal("invented authoritative row")
	}
	ranks := map[string]int{}
	for _, submission := range submissions {
		ranks[submission.Author.Members[0].Handle] = submission.Author.Rank
	}
	if ranks["a"] != 1 || ranks["b"] != 2 || ranks["c"] != 2 {
		t.Fatal(ranks)
	}
}

// Expected scores come from contest.standings, including its rejectedAttemptCount.
func TestMissingRowsMatchCodeforcesDurationScoring(t *testing.T) {
	cases := []struct {
		name              string
		duration, seconds int64
		maximum, expected float64
		wrong             int
	}{
		{"1137/sunset/A", 9000, 470, 500, 489, 0},
		{"1137/sunset/E", 9000, 4072, 2500, 1914, 1},
		{"2262/Kevin114514/C", 10800, 2479, 1750, 1509, 1},
		{"1735/9u46/B", 8100, 763, 750, 664, 1},
		{"1916/Benq/F", 7200, 5500, 2750, 1599, 3},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			contest := Contest{Type: "CF", DurationSeconds: c.duration}
			problem := Problem{Index: "A", Points: c.maximum}
			party := Party{Members: []Member{{Handle: "user"}}, ParticipantType: "CONTESTANT"}
			submissions := map[int]Submission{}
			for i := 1; i <= c.wrong; i++ {
				submissions[i] = Submission{ID: i, RelativeTimeSeconds: int64(i), Verdict: "WRONG_ANSWER", Problem: problem, Author: party}
			}
			id := c.wrong + 1
			submissions[id] = Submission{ID: id, RelativeTimeSeconds: c.seconds, Verdict: "OK", Problem: problem, Author: party}
			view, _ := Project(contest, &Standings{Contest: contest, Problems: []Problem{problem}}, submissions, NewHandleSet([]string{"user"}))
			if len(view.Rows) != 1 || view.Rows[0].Points != c.expected {
				t.Fatalf("expected %v points, got %#v", c.expected, view.Rows)
			}
		})
	}
}
