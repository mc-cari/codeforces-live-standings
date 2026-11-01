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
