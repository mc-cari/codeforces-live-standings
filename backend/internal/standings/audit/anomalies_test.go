package audit

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/mc-cari/codeforces-live-standings/backend/internal/standings/domain"
)

func TestSyntheticAnomaliesAndThrottle(t *testing.T) {
	now := time.Unix(100, 0)
	type warning struct {
		message string
		attrs   map[string]any
	}
	var events []warning
	r := &Reporter{pending: make(map[key]*pending), now: func() time.Time { return now }, warn: func(message string, args ...any) {
		attrs := make(map[string]any)
		for i := 0; i+1 < len(args); i += 2 {
			attrs[args[i].(string)] = args[i+1]
		}
		events = append(events, warning{message: message, attrs: attrs})
	}}
	contest := domain.Contest{ID: 7, Type: "CF", DurationSeconds: 100}
	party := domain.Party{ParticipantType: "CONTESTANT", Members: []domain.Member{{Handle: "Alice", Name: "Standings Name"}}}
	standing := domain.Standings{Contest: contest, Rows: []domain.RanklistRow{{Party: party}}}
	other := party
	other.Members = []domain.Member{{Handle: "alice", Name: "Submission Name"}}
	problem := domain.Problem{ContestID: 7, Index: "A", Name: "A"}
	changedProblem := problem
	changedProblem.Name = "Renamed A"
	subs := []domain.Submission{
		{ID: 1, RelativeTimeSeconds: -1, Author: party, Problem: problem},
		{ID: 2, RelativeTimeSeconds: 101, Author: other, Problem: changedProblem},
	}
	r.ObserveSubmissions(standing, subs)
	firstCount := len(events)
	if firstCount != 4 {
		t.Fatalf("expected four anomaly kinds, got %d: %v", firstCount, events)
	}
	r.ObserveSubmissions(standing, subs)
	if len(events) != firstCount {
		t.Fatal("warning emitted before throttle expired")
	}
	now = now.Add(throttle)
	r.ObserveSubmissions(standing, subs)
	if len(events) != firstCount+4 {
		t.Fatalf("warnings did not resume after throttle: %v", events)
	}
	for _, event := range events {
		if event.message != "Codeforces input anomaly observed" || event.attrs["contest_id"] != 7 || event.attrs["count"].(int) <= 0 {
			t.Fatalf("unstable warning: %#v", event)
		}
		if len(event.attrs["source_ids"].([]int)) > 3 {
			t.Fatalf("too many IDs: %#v", event.attrs)
		}
		if event.attrs["anomaly_kind"] == "participant_metadata_conflict" && len(event.attrs["differing_fields"].([]string)) == 0 {
			t.Fatalf("missing field names: %#v", event.attrs)
		}
		if strings.Contains(fmt.Sprint(event), "Standings Name") || strings.Contains(fmt.Sprint(event), "Submission Name") || strings.Contains(fmt.Sprint(event), "Renamed A") {
			t.Fatalf("warning exposed display or payload value: %#v", event)
		}
	}
}

func TestSyntheticHackAnomalies(t *testing.T) {
	var kinds []string
	r := &Reporter{pending: make(map[key]*pending), now: time.Now, warn: func(_ string, args ...any) {
		for i := 0; i+1 < len(args); i += 2 {
			if args[i] == "anomaly_kind" {
				kinds = append(kinds, args[i+1].(string))
			}
		}
	}}
	contest := domain.Contest{ID: 8, Type: "ICPC", StartTimeSeconds: 100}
	r.ObserveHack(contest, 44, 99, domain.Party{}, domain.Party{}, domain.Standings{Contest: contest})
	if len(kinds) != 2 || kinds[0] != "hack_before_contest_start" || kinds[1] != "hack_attached_to_non_cf_contest" {
		t.Fatal(kinds)
	}
}
