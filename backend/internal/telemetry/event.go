package telemetry

import (
	"errors"
	"math"
	"regexp"
)

type Event struct {
	ID      string   `json:"id"`
	Kind    string   `json:"kind"`
	Mode    string   `json:"mode"`
	Seconds *float64 `json:"seconds,omitempty"`
}

type Total struct {
	Kind, Mode string
	Value      float64
}

var eventID = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,64}$`)

func (event Event) Validate() error {
	valid := false
	switch event.Kind {
	case "page_view":
		valid = event.Mode == "setup" || event.Mode == "live" || event.Mode == "replay" || event.Mode == "demo"
	case "setup_completed":
		valid = event.Mode == "live" || event.Mode == "replay"
	case "view_displayed", "loading_failed":
		valid = event.Mode == "live" || event.Mode == "replay" || event.Mode == "demo"
	case "countdown_view":
		valid = event.Mode == "live"
	}
	if !valid || !eventID.MatchString(event.ID) {
		return errors.New("invalid event")
	}
	if event.Kind == "view_displayed" {
		if event.Seconds == nil || math.IsNaN(*event.Seconds) || math.IsInf(*event.Seconds, 0) || *event.Seconds < 0 || *event.Seconds > 86400 {
			return errors.New("invalid duration")
		}
	} else if event.Seconds != nil {
		return errors.New("unexpected duration")
	}
	return nil
}

func KnownTotals() []Total {
	var totals []Total
	for _, mode := range []string{"setup", "live", "replay", "demo"} {
		totals = append(totals, Total{Kind: "page_view", Mode: mode})
	}
	for _, mode := range []string{"live", "replay"} {
		totals = append(totals, Total{Kind: "setup_completed", Mode: mode})
	}
	for _, mode := range []string{"live", "replay", "demo"} {
		totals = append(totals, Total{Kind: "view_displayed", Mode: mode})
	}
	return append(totals, Total{Kind: "countdown_view", Mode: "live"})
}
