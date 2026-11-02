package domain

// ResolveICPCPenalty learns from complete official rows, before friend filtering.
// Missing or conflicting evidence never replaces an already learned rule.
func (s *Standings) ResolveICPCPenalty(previous *Standings) {
	if s.Authoritative || s.Contest.Type != "ICPC" {
		return
	}
	if s.ICPCPenaltyRule != nil {
		return
	}
	if previous != nil && previous.Contest.ID == s.Contest.ID && previous.ICPCPenaltyRule != nil {
		rule := *previous.ICPCPenaltyRule
		s.ICPCPenaltyRule = &rule
		return
	}
	candidates := map[int]bool{}
	for _, row := range s.Rows {
		if row.Party.ParticipantType != "CONTESTANT" {
			continue
		}
		minutes, wrong, solved := 0, 0, 0
		valid := true
		for _, result := range row.ProblemResults {
			if result.Points <= 0 {
				continue
			}
			// Zero/missing timestamps cannot supply reliable evidence here.
			if result.BestSubmissionTimeSecs <= 0 || result.RejectedAttemptCount < 0 {
				valid = false
				break
			}
			solved++
			minutes += result.BestSubmissionTimeSecs / 60
			wrong += result.RejectedAttemptCount
		}
		extra := row.Penalty - minutes
		if valid && row.Points == float64(solved) && wrong > 0 && extra >= 0 && extra%wrong == 0 {
			candidates[extra/wrong] = true
		}
	}
	if len(candidates) == 1 {
		for minutes := range candidates {
			s.ICPCPenaltyRule = &PenaltyRule{Minutes: minutes, Source: "observed"}
		}
	}
}

func (s Standings) WrongAttemptPenaltyMinutes() int {
	if s.ICPCPenaltyRule != nil {
		return s.ICPCPenaltyRule.Minutes
	}
	if s.Contest.ID < 100000 {
		return 10
	}
	return 20
}
