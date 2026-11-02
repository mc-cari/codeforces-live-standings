package audit

import (
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

const throttle = 5 * time.Minute
const maxKeys = 64

type key struct {
	contest int
	kind    string
}
type pending struct {
	count int
	ids   []int
	last  time.Time
}
type Reporter struct {
	mu      sync.Mutex
	pending map[key]*pending
	now     func() time.Time
	warn    func(string, ...any)
}

func NewReporter() *Reporter {
	return &Reporter{pending: make(map[key]*pending), now: time.Now, warn: slog.Warn}
}

func (r *Reporter) observe(contest int, kind string, ids ...int) {
	r.observeFields(contest, kind, nil, ids...)
}
func (r *Reporter) observeFields(contest int, kind string, fields []string, ids ...int) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	k := key{contest, kind}
	p := r.pending[k]
	if p == nil {
		if len(r.pending) >= maxKeys {
			for old := range r.pending {
				delete(r.pending, old)
				break
			}
		}
		p = &pending{}
		r.pending[k] = p
	}
	if p.count < 1_000_000_000 {
		p.count++
	}
	for _, id := range ids {
		if id <= 0 || len(p.ids) >= 3 {
			continue
		}
		found := false
		for _, existing := range p.ids {
			if existing == id {
				found = true
				break
			}
		}
		if !found {
			p.ids = append(p.ids, id)
		}
	}
	now := r.now()
	if !p.last.IsZero() && now.Sub(p.last) < throttle {
		return
	}
	args := []any{"anomaly_kind", kind, "contest_id", contest, "count", p.count, "source_ids", append([]int(nil), p.ids...)}
	if len(fields) > 0 {
		args = append(args, "differing_fields", fields)
	}
	r.warn("Codeforces input anomaly observed", args...)
	p.count, p.ids, p.last = 0, nil, now
}

// ObserveSubmissions compares only source fields needed by the compatibility projection.
func (r *Reporter) ObserveSubmissions(standings domain.Standings, submissions []domain.Submission) {
	contest := standings.Contest
	handles := map[string]string{}
	type groupKey struct{ handle, problem string }
	type sourceShape struct {
		party, problem string
		id             int
	}
	groups := map[groupKey]map[string][]int{}
	standingParties := map[string]domain.Party{}
	for _, row := range standings.Rows {
		for _, member := range row.Party.Members {
			standingParties[strings.ToLower(member.Handle)] = row.Party
		}
	}
	for _, s := range submissions {
		if s.Author.ParticipantType == "CONTESTANT" || s.Author.ParticipantType == "OUT_OF_COMPETITION" {
			if contest.DurationSeconds > 0 && (s.RelativeTimeSeconds < 0 || s.RelativeTimeSeconds > contest.DurationSeconds) {
				r.observe(contest.ID, "submission_outside_contest_window", s.ID)
			}
		}
		partyBytes, _ := json.Marshal(s.Author)
		problemBytes, _ := json.Marshal(s.Problem)
		for _, member := range s.Author.Members {
			folded := strings.ToLower(member.Handle)
			if old, ok := handles[folded]; ok && old != member.Handle {
				r.observe(contest.ID, "handle_case_variants", s.ID)
			}
			handles[folded] = member.Handle
			if official, ok := standingParties[folded]; ok {
				for _, officialMember := range official.Members {
					if strings.EqualFold(officialMember.Handle, member.Handle) && officialMember.Handle != member.Handle {
						r.observe(contest.ID, "handle_case_variants", s.ID)
						break
					}
				}
				fields := differingPartyFields(official, s.Author)
				if len(fields) > 0 {
					r.observeFields(contest.ID, "participant_metadata_conflict", fields, s.ID)
				}
			}
			gk := groupKey{folded, s.Problem.Index}
			shape := sourceShape{string(partyBytes), string(problemBytes), s.ID}
			if groups[gk] == nil {
				groups[gk] = map[string][]int{}
			}
			keyBytes := shape.party + "\x00" + shape.problem
			groups[gk][keyBytes] = append(groups[gk][keyBytes], shape.id)
		}
	}
	for _, variants := range groups {
		if len(variants) < 2 {
			continue
		}
		var ids []int
		for _, group := range variants {
			ids = append(ids, group...)
		}
		r.observeFields(contest.ID, "source_party_problem_variants", []string{"party", "problem"}, ids...)
	}
}

func differingPartyFields(a, b domain.Party) []string {
	var fields []string
	if a.ParticipantType != b.ParticipantType {
		fields = append(fields, "participantType")
	}
	if a.TeamID != b.TeamID {
		fields = append(fields, "teamId")
	}
	if a.TeamName != b.TeamName {
		fields = append(fields, "teamName")
	}
	if a.ContestID != b.ContestID {
		fields = append(fields, "contestId")
	}
	if a.Ghost != b.Ghost {
		fields = append(fields, "ghost")
	}
	if a.Rank != b.Rank {
		fields = append(fields, "rank")
	}
	if len(a.Members) != len(b.Members) {
		fields = append(fields, "members")
	} else {
		for i := range a.Members {
			if a.Members[i].Handle != b.Members[i].Handle {
				fields = append(fields, "members.handle")
				break
			}
			if a.Members[i].Name != b.Members[i].Name {
				fields = append(fields, "members.name")
				break
			}
		}
	}
	return fields
}

// ObserveHack audits hack records retained in the CLICS metadata extension.
func (r *Reporter) ObserveHack(contest domain.Contest, id int, creationTime int64, hacker, defender domain.Party, standings domain.Standings) {
	if creationTime < contest.StartTimeSeconds {
		r.observe(contest.ID, "hack_before_contest_start", id)
	}
	if contest.Type != "CF" {
		r.observe(contest.ID, "hack_attached_to_non_cf_contest", id)
	}
	for _, party := range []domain.Party{hacker, defender} {
		for _, member := range party.Members {
			for _, row := range standings.Rows {
				for _, standingMember := range row.Party.Members {
					if strings.EqualFold(member.Handle, standingMember.Handle) && len(differingPartyFields(row.Party, party)) > 0 {
						r.observeFields(contest.ID, "participant_metadata_conflict", differingPartyFields(row.Party, party), id)
					}
				}
			}
		}
	}
}
