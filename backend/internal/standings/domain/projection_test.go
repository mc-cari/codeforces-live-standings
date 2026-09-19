package domain

import "testing"

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
