package domain

import "testing"

func evidence(minutes int) RanklistRow {
	return RanklistRow{Party: Party{ParticipantType: "CONTESTANT"}, Points: 1, Penalty: 3 + minutes,
		ProblemResults: []ProblemResult{{Points: 1, RejectedAttemptCount: 1, BestSubmissionTimeSecs: 180}}}
}

func TestPenaltyRules(t *testing.T) {
	gym := Contest{ID: 100001, Type: "ICPC"}
	first := Standings{Contest: gym, Rows: []RanklistRow{evidence(7)}}
	first.ResolveICPCPenalty(nil)
	if first.ICPCPenaltyRule == nil || first.WrongAttemptPenaltyMinutes() != 7 {
		t.Fatal(first)
	}
	for _, rows := range [][]RanklistRow{nil, {evidence(9)}, {evidence(7), evidence(9)}} {
		next := Standings{Contest: gym, Rows: rows}
		next.ResolveICPCPenalty(&first)
		next.ResolveICPCPenalty(nil) // Projection must not relearn from the filtered/current response.
		if next.WrongAttemptPenaltyMinutes() != 7 {
			t.Fatal("lost learned rule", next)
		}
	}
	conflict := Standings{Contest: gym, Rows: []RanklistRow{evidence(7), evidence(9)}}
	conflict.ResolveICPCPenalty(nil)
	if conflict.ICPCPenaltyRule != nil || conflict.WrongAttemptPenaltyMinutes() != 20 {
		t.Fatal("learned conflicting evidence")
	}
	override := Standings{Contest: gym, Rows: []RanklistRow{evidence(7)}, ICPCPenaltyRule: &PenaltyRule{Minutes: 0, Source: "override"}}
	override.ResolveICPCPenalty(&first)
	if override.WrongAttemptPenaltyMinutes() != 0 {
		t.Fatal("override lost")
	}
	public := Standings{Contest: Contest{ID: 1739, Type: "ICPC"}}
	public.ResolveICPCPenalty(&first)
	if public.ICPCPenaltyRule != nil || public.WrongAttemptPenaltyMinutes() != 10 {
		t.Fatal("leaked rule across contests")
	}
	invalid := evidence(7)
	invalid.ProblemResults[0].BestSubmissionTimeSecs = 0
	missing := Standings{Contest: gym, Rows: []RanklistRow{invalid}}
	missing.ResolveICPCPenalty(nil)
	if missing.ICPCPenaltyRule != nil {
		t.Fatal("learned from missing timestamp")
	}
	// Row-level totals allow inference when per-problem penalty fields are absent.
	row := evidence(7)
	row.ProblemResults[0].RejectedAttemptCount = 2
	row.Penalty = 17
	multi := Standings{Contest: gym, Rows: []RanklistRow{row}}
	multi.ResolveICPCPenalty(nil)
	if multi.WrongAttemptPenaltyMinutes() != 7 {
		t.Fatal("wrong aggregate inference")
	}
}
