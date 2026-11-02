# Optional backend E2E tests

These tests run the direct Codeforces provider and the real live-v3 converter through
Go activation and SSE routes, with isolated SQLite databases and a local API fixture
server. They require no Codeforces credentials or network during execution.

The suite includes 18 snapshots across 12 finished contests: 12 official cases and
six participant-type cases. Each official case retains four individuals with accepted
submissions and rejected attempts, no hacks, and their contest-time submission history.
Original API scores, penalties, and rank groups are the oracle. Tests compare total
and per-problem points, penalty, friend ranks, complete history arrival, and
case-insensitive selection in a different input order. Row order within a tied rank
is ignored.
The catalog in `contests.json` also verifies contest identity, scoring type, and duration.
Global ranks are not compared: the converter sees only the selected competitors.
This suite does not cover hack scoring or live rejudges.

| Contest | Round | Scoring | Duration |
| --- | --- | --- | --- |
| 1735 | Codeforces Round 824 (Div. 2) | CF | 135 min |
| 1739 | Educational Codeforces Round 136 (Rated for Div. 2) | ICPC | 120 min |
| 1753 | Codeforces Round 829 (Div. 1) | CF | 120 min |
| 1754 | Codeforces Round 829 (Div. 2) | CF | 120 min |
| 1741 | Codeforces Round 826 (Div. 3) | ICPC | 135 min |
| 1742 | Codeforces Round 827 (Div. 4) | ICPC | 145 min |
| 1740 | Codeforces Round 831 (Div. 1 + Div. 2) | CF | 165 min |
| 1750 | CodeTON Round 3 (Div. 1 + Div. 2, Rated, Prizes!) | CF | 150 min |
| 1743 | Educational Codeforces Round 137 (Rated for Div. 2) | ICPC | 120 min |
| 1749 | Educational Codeforces Round 138 (Rated for Div. 2) | ICPC | 120 min |
| 1737 | Dytechlab Cup 2022 | CF | 150 min |
| 1799 | Codeforces Round 854 by cybercats (Div. 1 + Div. 2) | CF | 180 min |

The ten added contests cover Div. 1, Div. 2, Div. 3, Div. 4, combined divisions,
educational rounds, and a cup. Six distinct durations range from 120 to 180 minutes.

Build the pinned converter first (rebuild after updating the submodule):

```sh
cd vendor/live-v3
./gradlew :cds-converter:installDist -Plive.dev.embedFrontend=false
cd ../../backend
LIVE_V3_TEST_BINARY="$PWD/../vendor/live-v3/src/cds-converter/build/install/cds-converter/bin/cds-converter" \
  go test -tags=e2e ./tests/e2e -count=1 -timeout=5m
```

The `e2e` build tag excludes these tests from ordinary `go test ./...`. Explicit
runs fail if the converter is missing, so a successful run always tests both engines.

To refresh the minimized API snapshots (requires network, Python 3, several large API
responses, and may select different competitors as historical data changes):

```sh
python3 backend/tests/e2e/capture.py
```

Capture only selected contests, optionally reusing raw API responses in a local cache:

```sh
python3 backend/tests/e2e/capture.py --contests 1753 1754 --cache-dir /tmp/cf-e2e-api
```

The default refresh includes all 12 contests; the six participant-type cases are
regenerated only for 1735 and 1739. New official cases fetch submissions by selected
handle; only the original participant-type cases require the large bulk history.
Committed fixtures contain only the selected competitors. Source URLs record whether
the snapshot used bulk or per-handle responses. Omit `--cache-dir` for fresh responses.

Review fixture changes before committing them. Each file records capture time and
source URLs; API envelopes and selected entities are retained without rewriting scores.

The direct provider passes the official API snapshots. Four ICPC contests (1741,
1742, 1743, and 1749) exposed live-v3 ranks that split teams with equal solved count
and penalty. The Go projection now assigns those rows the same friend rank using
the ICPC tie rule. The assertions compare rows by rank group and participant, so
their display order within a tie does not affect the result.

`TestCapturedTeamHistoryThroughProvidersAndSSE` adds real team-history coverage for
contests 639 and 640. It replays two official teams per contest through both providers
and the actual HTTP/SSE routes. Multi-member teams are selected through the second
member and through both members; the single-member team is selected through its member.
It checks one team row, unique submission IDs, per-problem results, total points, and
penalties against the standings API. The Kotlin replay tests also check the selected
teams' relative order. The source records are retained in
`backend/testdata/team-replay/`; the test makes no live Codeforces requests. Contest
639's unofficial TLE #98 has no standings oracle and remains covered by the Kotlin
engine replay for zero score and unofficial status.

```sh
# From backend/, with LIVE_V3_TEST_BINARY set as above:
go test -tags=e2e ./tests/e2e -run TestCapturedTeamHistoryThroughProvidersAndSSE -count=1 -timeout=5m
```

Both engines pass the official 1735 and 1739 fixtures in the current local replay.

Six additional cases (`*-unofficial`, `*-virtual`, and `*-practice`) mix one official
control with a real API participant of the named type in each contest. They compare
participant types as well as scores, selected-handle inclusion, and submission IDs,
verdicts, and author types. The control has no rejected submissions on solved problems
to isolate these cases from ICPC penalty reconstruction.

Codeforces currently rejects anonymous `showUnofficial=true` standings requests.
These cases therefore keep only actual official rows in the API standings envelope,
replay real unofficial submissions, and store a separate `expectedRows` oracle for
missing-row behavior. Each added party has one contest-time accepted submission
(no rejection penalty), or one skipped submission for the educational unofficial
case, where the captured API has no accepted unofficial submissions. Expected
scores are independently auditable from that single submission: CF points decay by
whole elapsed minutes, while ICPC uses one solved problem and elapsed-minute penalty.
Practice and virtual snapshots are limited to relative times within contest duration;
they do not cover multiple attempts by the same handle in different participant types.

Both engines agree on the `OUT_OF_COMPETITION` cases. The live-v3 source excludes
virtual and practice parties, so those live-v3 comparisons are skipped; the direct
provider remains checked for them. To run just unofficial coverage:

```sh
# From backend/, with LIVE_V3_TEST_BINARY set as above:
go test -tags=e2e ./tests/e2e -run 'TestSnapshotScoringAgreement/.*-unofficial' -count=1
```

`TestICPCPenaltyRetention` is an additional synthetic HTTP/SSE regression using
`scenarios/icpc-penalty.json`. It learns a custom seven-minute Gym penalty from an
unselected official row, removes that evidence, then provides conflicting nine-minute
evidence while adding unofficial solves. Both providers must retain seven minutes.
The Go case also verifies that SQLite stores the resolved rule and reactivation
preserves it despite conflicting current API evidence. This scenario is deliberately
separate from the 18 captured real-contest snapshots.

```sh
# From backend/, with LIVE_V3_TEST_BINARY set:
go test -tags=e2e ./tests/e2e -run TestICPCPenaltyRetention -count=1 -timeout=3m
```

With the synthetic regression included, the complete optional suite runs in about
45 seconds locally. The penalty retention regression passes for both providers.
