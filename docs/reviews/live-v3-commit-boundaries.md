# live-v3 and the standings adapter: commit review and ownership recommendations

Review date: **2026-11-01**. Scope: the current implementation and its independently reviewable upstream contribution boundaries.

**Correction follow-up (2026-11-01).** Duration-based CF score decay has been restored in the vendored engine and aligned in the Go and browser direct-source fallbacks. Section 6.3 records fresh API comparisons and the correction. The commit revisions and original audit results below remain historical snapshots; this follow-up does not rewrite them. The engine correction is committed as `2f45141a`, and the parent repository pins that revision.

## 1. What this review covers

There are two related pull requests:

- [mc-cari/live-v3 PR #1](https://github.com/mc-cari/live-v3/pull/1): the integration fork, now **12 commits** from base `4afb37ea2bece05f22e208a4a6476caede2fe8a2` through `e03fc8e1cd9cd4a6d64084c904dae0c298ae8b10`.
- [mc-cari/codeforces-live-standings PR #37](https://github.com/mc-cari/codeforces-live-standings/pull/37): the Go application at `590f7ca`, consuming the standard CDS converter through CLICS.

**Upstream delivery policy: propose selected changes separately, not this entire fork stack at once.** The integration branch keeps the application working and preserves pushed history. It is not the branch to submit wholesale to the main live-v3 project. Section 11 defines focused proposal units, their dependencies, and the checks needed before calling them independent. This documentation update does not split, rebase, or rewrite existing commits.

The report describes code present at these revisions. Section 6 reviews the retained fork changes; section 7 describes the Go application. Baseline comparisons are included only to establish which current changes correct upstream behavior and can be proposed independently.

### Current implementation

1. **Both sources use the Go application.** Direct Codeforces polling and live-v3 CLICS use shared sessions, persistence, friend projection, revisions, backpressure handling, and public HTTP/SSE transport. Selection is fixed at startup.
2. **Go runs the standard CDS converter.** Go supervises one converter child per active contest and consumes CLICS events plus calculated scoreboards. Live-v3 owns ingestion, interpretation, scoring, and contest state; Go owns durable application views and browser delivery.
3. **The fork adds optional generic CLICS exports.** `x_live` carries native metadata, judging progress, feed-instance identity, and a scoreboard event watermark. `include_unofficial` exports supported unofficial calculated rows and tie ranks. Codeforces-specific metadata interpretation remains in Go.
4. **Recovery retains Go views and reloads the worker.** Replay is staged until it matches a calculated scoreboard. There is no durable engine acquisition-history store. Go uses the CLICS scoreboard watermark as its publication boundary.
5. **Deployment and compatibility checks follow this boundary.** Compose builds a combined Go/JVM image from the pinned submodule. The architecture diagrams and CI describe this deployment.

### Findings that remain unresolved

The current fork retains these unresolved parser/scoring findings:

1. Omitted attempts, invalidated submissions receiving points, missing problem maxima, and rejection of `SUBMITTED` have reproduced original failures. These are candidates for focused upstream corrections.
2. Premature finalization during system testing is reproduced **when auto-finalization is enabled**. The phase fix prevents that failure, but its `RUNNING` semantics still need review.
3. The reviewed snapshot contains the incorrect duration-independent decay change. A follow-up correction now restores duration-based decay across the engine and both direct-source fallbacks; fresh API evidence and remaining limits are recorded in section 6.3.
4. The replacement source in `7820d537` has a cold-finished restoration/finalization regression. The standard converter is run with `--no-auto-finalize`; that configuration avoids this consumer path, not the underlying compatibility issue.
5. The reviewed implementation could reset an inferred ICPC penalty when later evidence disappeared. The follow-up in section 6.6 fixes that instability in both sources; heuristic cold-start defaults and missing rejection history remain limitations.

The [audit runner](evidence/live-v3-commit-review/run_audits.py) and [audit results](evidence/live-v3-commit-review/audit-results.json) contain 17 characterization cases. Its case named `current_fork` is explicitly pinned to **`f310cc41`**, not `e03fc8e1`. Those audits were not retargeted or rerun for this documentation update. Passing characterization checks means the described observations—including defects—were reproduced; it does not establish that every behavior is correct.

## 2. The systems, explained from the beginning

**Codeforces** runs contests and exposes submissions, verdicts, participants, and standings through its API. Verdicts can change during further testing or rejudging.

**live-v3** is the independent contest engine. Its Codeforces plugin acquires and converts source data; its scoring machinery calculates standings. Its standard CDS converter exposes those results through CLICS.

**codeforces-live-standings** is our application. Go owns sessions, SQLite persistence, activation, friend filtering, browser subscriptions, SSE, and telemetry. The frontend consumes the same public routes and event shapes with either source.

**The Go adapter** starts and monitors converter processes, consumes the CLICS feed, joins native Codeforces metadata into frontend-compatible objects, and stages updates until their scoreboard watermark agrees. It does not calculate alternative live-v3 scores. The missing-row scoring fallback remains confined to direct polling, including the browser's direct-polling path; SSE projections preserve the Go view.

**Upstream** is the main live-v3 project. **Our fork** contains both general corrections and optional integration capabilities. A commit being generic, separately named, or well tested does not by itself make it an independent upstream proposal. It must also build and demonstrate its behavior without unrelated fork changes.

### Current implemented integration

| Responsibility | Owner |
| --- | --- |
| Codeforces acquisition and in-process attempt retention in live-v3 mode | Codeforces plugin in the standard converter |
| Contest interpretation, scoring, ordering, and tie information | live-v3 |
| Generic CLICS events, optional native metadata, and synchronization exports | CDS converter |
| Worker configuration, readiness, restart backoff, capacity, and shutdown | Go adapter/application |
| Scoped normalized entities and complete calculated application views | Go SQLite |
| Replay staging and publication after a matching scoreboard watermark | Go adapter and shared session |
| Friend positions, per-browser limits, HTTP/SSE, and frontend compatibility | Go application; frontend preserves SSE data |
| Direct Codeforces polling and its existing missing-row fallback | Direct provider, separate from authoritative live-v3 results |

The data path is Codeforces → standard converter → CLICS → shared Go application → browsers. SQLite stores Go's observed entities and calculated views. The architecture diagrams are maintained in [the provider overview](../architecture/live-v3-architecture.html) and [the Go application diagram](../architecture/go-backend-architecture.html).

`STANDINGS_SOURCE` selects `codeforces` or `livev3` at startup. Go starts one standard converter child per active contest, shared by all viewers, on a private loopback listener. The optional image includes Go, a JVM, and the converter distribution from the pinned fork; it does not require Docker-daemon access at runtime.

The integration fork branch is `feat/live-standings-backend`, pinned at `e03fc8e1`. Go consumes its standard CLICS endpoints. Parser internals, source configuration, and scoring remain in live-v3; browser contracts and application persistence remain in Go.

## 3. Terminology used in the commit descriptions

| Term | Meaning in this review |
| --- | --- |
| API / endpoint | A programmatic interface; an endpoint is one address or operation, such as `contest.status`. |
| HTTP / CORS | HTTP is the request/response protocol used here. CORS is the browser mechanism that controls whether a page from one origin can read responses from another; the service configures which frontend origins it permits. |
| JSON / payload | JSON is the structured text exchanged with the API. A payload is one response's data. |
| Parser / conversion | Code that reads source data and turns it into live-v3 objects. |
| Typed data / serialization | Typed data has declared fields and allowed values. Serialization writes an object into an exchange format; deserialization reads it back. |
| Raw history | Previously received source records retained before converting or scoring them. The current fork retains typed/JSON representations; this is not necessarily a byte-for-byte archive of every response. |
| Submission / run | A Codeforces submission is a program sent to the judge. A live-v3 `RunInfo` is its internal representation. Some runs represent hacks rather than actual submissions. |
| Verdict | A judging result, such as accepted, wrong answer, testing, or queued. |
| Rejudging / system testing | Later evaluation that can change an earlier result. System testing is Codeforces' post-coding evaluation against its full tests. |
| Pretests | The initial tests used during some Codeforces rounds; passing them does not guarantee the final result. |
| Hack | A contestant-supplied test intended to invalidate another contestant's solution. A synthetic hack run is an engine record representing its scoring effect. |
| Standings / scoreboard | A table of participants, their results, and ranks. |
| Party / team | Codeforces' participant object is called a party. live-v3 represents both individual contestants and teams using its team model. |
| CF / ICPC / IOI | Names for scoring formats. CF uses points, time decay, and attempt deductions. ICPC primarily uses solved count and time penalties. IOI is a score-oriented format; live-v3 also uses its IOI-style result objects to represent CF points. These labels are not interchangeable. |
| Educational / Gym | Educational rounds are a Codeforces contest series using extended ICPC rules. Gym hosts other contests with potentially different rules. A contest's category alone is not a complete rules specification. |
| Penalty | In CF, often a deduction from points. In ICPC-style scoring, accumulated time used to order participants with equal solved counts. |
| Poll / reload | One acquisition cycle. Polling repeats cycles to observe changes. |
| Upsert | Insert a record if its ID is new; replace its value if that ID already exists. Omitted records are not automatically deleted. |
| Durable / checkpoint / restore | Durable data survives a process restart. A checkpoint is a saved view or state. Restoration reloads saved data after startup. |
| SQLite / SQL | SQLite is the embedded database used by our service. SQL is the language used to query and update its tables. |
| Flow / event / collector | A Kotlin `Flow` emits a sequence of events to a consumer called a collector. `InfoUpdate` changes contest information; `RunUpdate` changes a run. |
| Auto-finalization | An engine transformation that decides no more updates are needed and ends consumption. `OVER` and `FINALIZED` are distinct engine statuses. |
| Callback / hook | A function supplied by another component, called when an operation occurs. For example, `onReload` runs after a reload's events have been delivered synchronously. |
| Metadata / sidecar | Metadata is supplementary information. A sidecar map stores it alongside engine objects, joined by stable IDs, rather than adding it to every engine object. |
| Public / internal API | Public functions are intended for external callers. Kotlin `internal` declarations are normally accessible only within their compilation module. |
| ABI / API check | ABI means the compiled binary interface. An API check compares exported signatures with a checked-in reference. Updating that reference can approve a deliberate change; a passing check does not establish compatibility with older binaries. |
| SSE / snapshot / patch / revision | Server-Sent Events deliver server-to-browser updates over a persistent HTTP connection. A snapshot replaces a view; a patch updates selected entries. A revision identifies a published version. |
| Backpressure / conflation | Backpressure means consumers cannot keep up. Conflation keeps the latest value instead of queuing every intermediate value. Clients need replacement snapshots when intermediate patches are skipped. |
| Transaction / semaphore | A database transaction commits related writes together. A semaphore limits how many operations or connections can run concurrently. |
| JVM / Gradle / TypeScript | The JVM runs compiled Kotlin here. Gradle builds and tests the projects. TypeScript describes frontend-facing object shapes. |
| Kotlin / Go / CI | Kotlin implements live-v3 and its standard converter. Go implements our application backend. CI runs automated checks for proposed changes. |
| Credentials / manager mode / signed URL | An API key and secret authenticate privileged requests. Manager mode requests privileged contest access. Signing derives an authentication value from the request and secret; query strings can therefore contain sensitive authentication data. |
| Schema / generated contract | A schema specifies valid configuration data. Generated contracts are files derived from code, such as settings schemas, TypeScript definitions, and exported signature lists. |
| CLICS / `x_live` | CLICS is the converter-to-Go interface. `x_live` is an optional extension for native metadata, judging progress, feed identity, and a calculated scoreboard watermark. It is distinct from browser SSE. |
| Feed instance / watermark | A feed instance identifies a generator lifetime. The watermark identifies the last emitted event corresponding to a calculated scoreboard state; it is not a durable history or a complete source-reload transaction marker. |
| Independent proposal / stacked proposal | An independent proposal builds and tests on its declared upstream base without other unmerged feature PRs. A stacked proposal explicitly depends on a named prerequisite and must disclose it. |
| Pin / submodule / cherry-pick | A pin names an exact dependency commit. A Git submodule records another repository at such a commit. Cherry-picking applies a selected commit elsewhere; conflicts or shared test dependencies may still need resolution. |
| Regression test / fixture / oracle | A regression test guards behavior against a known failure. A fixture supplies test data. An oracle is independent evidence for the expected answer, such as official standings. A synthetic expected value is not automatically an oracle. |

Codeforces' documented object definitions distinguish contest formats, participant types, submission verdicts, and problem-result fields. [Primary API reference](https://codeforces.com/apiHelp/objects).

## 4. How ownership is decided

For each change, ask four separate questions:

1. **Did the problem exist in the original live-v3 code?** A bug introduced by our integration should be fixed with that integration, rather than advertised as an upstream discovery.
2. **Would existing live-v3 users benefit if our backend disappeared?** Incorrect scores and unsupported source verdicts generally pass this test. Friend filtering and SQLite checkpoint policy do not.
3. **Is the implementation correct?** The right owner does not make a proposed formula, heuristic, or phase mapping correct.
4. **Does it require a lasting public API change?** New constructors, callbacks, serialized fields, or public types create maintenance and compatibility obligations even when they are broadly reusable.

The outcomes used below are:

- **Keep upstream:** a demonstrated general correction, with suitable regression coverage.
- **Revise upstream:** a general problem with an implementation or semantic question to resolve.
- **Split:** a commit combines changes with different owners or different evidence.
- **Move to our adapter:** application integration, persistence, transport, presentation, or operating policy.
- **Separate optional API proposal:** potentially useful to other consumers, but not an existing correctness bug.
- **Revert or hold:** evidence contradicts the implementation or is insufficient for its advertised scope.

## 5. Complete decision table

| Repository / commit | Main purpose | Recommendation |
| --- | --- | --- |
| live-v3 `493d0720` | Retain raw attempts across incomplete responses | Separate upstream correction candidate. Keep in-process retention; no durable source-history requirement. |
| live-v3 `706a03d0` | Avoid premature finalization during system testing | Keep the issue upstream; review phase semantics and strengthen pipeline tests. |
| live-v3 `850d64ab` | Make decay independent of contest length | Revert or revise before merging: an official long-round case contradicts it. |
| live-v3 `3b42675f` | Prevent invalidated runs from receiving points | Keep upstream; add replacement-submission and attempt-deduction coverage. |
| live-v3 `702ffa04` | Recover missing maximum points and prefer supplied positive scores | Split: keep the fallback upstream; separately validate score precedence. |
| live-v3 `e0837f40` | Set ICPC wrong-attempt penalties | Revise upstream: the Educational correction is valid, but inference/default behavior needs stronger rules and retention. |
| live-v3 `f412c08b` | Accept queued `SUBMITTED` verdicts | Keep upstream. |
| live-v3 `f1d25e38` | Add generic custom metadata to runs | Separate optional core-model proposal, with ABI review. Required by the current run-metadata export, not by the independent parser fixes. |
| live-v3 `d2852459` | Participant discovery, eligibility, identity, and raw metadata | Split generic correctness from optional capabilities and application policy. |
| live-v3 `7820d537` | Replace the source and expose persistence/operational hooks | Retained in the fork; Go uses its standard converter path, not embedding callbacks. Split generic configuration from hooks and fix the cold-finished regression before proposing source replacement. |
| live-v3 `f310cc41` | Improve the new source's failure logs safely | Keep with the component that owns that source; not an independent pre-existing upstream bug. |
| live-v3 `e03fc8e1` | Generic CLICS metadata/progress, synchronization, unofficial rows, and CF settings | Keep integration working, but extract separate proposal units. The whole commit is not an independent upstream bug fix; see 6.12 and 11. |
| application `590f7ca` | Shared Go sessions, CLICS adapter, scoped SQLite, workers, frontend compatibility, deployment | Current application implementation; exclude from all upstream live-v3 proposals. |

## 6. Every live-v3 commit in detail

### 6.1 `493d0720` — retain raw attempts across partial status responses

[Full commit](https://github.com/mc-cari/live-v3/commit/493d07201f437d01b8a27a60ffeeb1fb8d40d1f8)

**Purpose.** Keep an accepted submission's score stable when a subsequent API response omits an earlier wrong attempt.

**Before.** The parser counted wrong attempts using only the current response. Consider a 500-point problem accepted at minute 10 after one penalty-bearing wrong attempt. In the two-hour fixture its score is 430. Reprocessing only the accepted submission makes the parser forget the deduction and return 480.

**After.** `CFContestInfo` keeps submissions in a map keyed by original submission ID. New observations replace old values for the same ID; missing IDs remain. It then performs conversion and attempt counting over that retained history. Rejudging is still possible because a later value for an existing ID replaces its earlier verdict.

**Evidence.** Audit E1 runs the original and current parsers. Original: 430 then 480. Current: 430 then 430. This proves the local failure for an incomplete input sequence. It does not measure how often Codeforces omits records or prove that every omission means retention is appropriate forever.

**Ownership.** This is an existing parser correctness issue, independent of our frontend, HTTP contract, or database. Keep the in-memory correction upstream. Persistence across process restarts is a different requirement. The current Go adapter retains observed CLICS entities and calculated views, but does not persist or replay the worker's acquired Codeforces history into the engine.

**Remaining questions.** Define whether an authoritative deletion/disqualification should ever remove retained data; account for memory growth and source lifetime. Do not silently reuse one parser's history for unrelated contests. These are design considerations, not measured failures in the audited one-contest sequence.

**Dependencies.** No new production API is needed. The commit also introduces shared fixture helpers used by later tests, so transferring later tests may require extracting those helpers into a separate test-support commit.

### 6.2 `706a03d0` — keep tracking through system testing

[Full commit](https://github.com/mc-cari/live-v3/commit/706a03d076be659aca41a4d63798aa48dd0a1ca5)

**Purpose.** Prevent consumers from treating post-coding testing as the end of all result changes.

**Before.** The Codeforces parser mapped both `PENDING_SYSTEM_TEST` and `SYSTEM_TEST` to live-v3 `OVER`. `OVER` itself does not stop the original reload source. However, the engine's `autoFinalize()` transformation ends consumption when status is `OVER`, the source does not advertise explicit finalization support, and no currently known run is in progress. Previously accepted pretest results can satisfy that condition even though system tests have not yet produced their later verdicts.

**After.** Those two Codeforces phases map to live-v3 `RUNNING`. `FINISHED` still maps to `OVER`. This prevents auto-finalization at the earlier phases in the reproduced sequence.

**Evidence.** Audit E2 feeds the real parser and original `FullReloadContestDataSource` a deterministic sequence: coding/accepted, pending-system-test/accepted, system-test/wrong-answer, finished/wrong-answer. Ordinary polling receives the changed verdict before and after the commit. With `autoFinalize()`, the original mapping misses it and the changed mapping receives it. No live contest is required to demonstrate this control-flow failure.

**Ownership.** The failure belongs upstream: auto-finalization and the Codeforces parser already existed there. It was not created by our backend.

**Recommendation.** Retain an upstream fix for premature finalization, but agree on the meaning of the statuses. `RUNNING` can imply the coding window is still open to other engine clients. A possible alternative is to retain `OVER`, set `cdsSupportsFinalization`, and emit a true finalization event only when source evidence permits it. That alternative is a proposal, not an implemented or audited replacement in this report. It also needs careful first-load event ordering and an explicit completion policy.

The direct Go provider uses two finished polls; the CLICS path stops on its normalized authoritative finished view. Neither policy resolves the upstream phase-model question. `addComputedData` currently defaults auto-finalization to disabled; the demonstrated original failure is conditional on enabling it or using a final-state helper that applies it.

### 6.3 `850d64ab` — use standard score decay for long rounds

[Full commit](https://github.com/mc-cari/live-v3/commit/850d64ab2cbb091bdf024ce929eb263b922eb1b2)

**Purpose as originally stated.** Make the rate at which CF problem points decrease independent of round duration.

**Before.** The per-minute decay was `(M - 0.52 * M) / roundedDuration`, where `M` is the problem's maximum score and `roundedDuration` is the round length in minutes rounded down to a multiple of 30, with a minimum rounded duration of 30 minutes (`max(1, durationMinutes / 30) * 30`).

**After.** The decay is always `M / 250`. For a 500-point problem, this is two points per minute, regardless of the contest length. The new test asserts the same 480-point result at minute 10 for 135-, 150-, and 180-minute synthetic contests.

**Evidence limitation.** Both formulas agree for a two-hour round. A two-hour fixture cannot validate their behavior for longer rounds. Tests that change duration but keep the expected score constant assume the conclusion rather than validating it independently.

**Counterexample.** The organizer's announcement identifies Round 545 as a 150-minute contest. Its published standings show participant `sunset` receiving 489 on problem A, whose maximum is 500, at minute 7. The original parser produces 489 for this reconstructed case; the changed parser produces 486. Exact seconds within that minute do not change either implementation. The fixed-rate formula cannot reach 489 even before a wrong-attempt deduction. [Organizer's announcement](https://codeforces.com/blog/entry/65768), [official standings](https://codeforces.com/contest/1137/standings).

Audit E3 reconstructs the relevant input from that published result; it is not a full captured API response or submission-history replay. It is nevertheless a concrete counterexample to universal duration independence.

**Fresh API verification (2026-11-01).** Direct calls to `contest.standings?contestId=…` compared every positive scored problem result for official `CONTESTANT` parties. Inputs were the problem maximum, whole-minute acceptance time, and `rejectedAttemptCount`. Both candidates included the same 50-point deduction per rejected attempt and 30% score floor. The API-derived [comparison summary](evidence/live-v3-commit-review/score-decay-api-comparison.json) records the observations; it is separate from audit E3 and does not contain full raw response captures.

| Contest | Duration | Duration-based matches | Fixed-rate matches |
| --- | --- | --- | --- |
| [1916](https://codeforces.com/api/contest.standings?contestId=1916) | 120 minutes | 36,922 / 36,922 | 36,922 / 36,922 |
| [1735](https://codeforces.com/api/contest.standings?contestId=1735) | 135 minutes | 22,578 / 22,578 | 22,578 / 22,578 |
| [1137](https://codeforces.com/api/contest.standings?contestId=1137) | 150 minutes | 1,087 / 1,087 | 11 / 1,087 |
| [2262](https://codeforces.com/api/contest.standings?contestId=2262) | 180 minutes | 2,011 / 2,011 | 1 / 2,011 |

Contest 1110 additionally matched both formulas on all 13,461 scored results at 120 minutes. Contest 1739 uses ICPC scoring and was excluded from the CF decay comparison. At 135 minutes, rounding the duration down to 120 makes both decay formulas agree. The long-round discrepancies also occur with wrong attempts: `sunset`, problem E in contest 1137, has maximum 2,500, acceptance at 4,072 seconds and one rejected attempt. The API and duration formula give 1,914; the fixed formula gives 1,780.

**Correction applied (`2f45141a` and the matching application changes).** Restore the original duration-based decay in live-v3 and apply the same full scoring calculation to the Go and browser direct-source missing-participant fallbacks:

```text
D = max(1, floor(durationSeconds / 60 / 30)) * 30
t = floor(submissionSeconds / 60)
score = max(0.30 * M, ceil(M - t * ((M - 0.52 * M) / D) - 50 * wrongAttempts))
```

Regression cases in all three implementations use the same five API-derived examples at 120, 135, 150 and 180 minutes, including wrong attempts and upward rounding. The erroneous test asserting duration independence has been replaced. Existing positive supplied submission scores keep their previous precedence; this correction does not resolve the separate supplied-score policy discussed in section 6.5.

**Correction validation.** The Go standings domain tests and all 10 browser standings-domain tests passed. The complete Codeforces plugin test suite passed (27 tests). These checks exercise the corrected code; the original 17-case audit was not rerun or relabeled.

**Ownership and recommendation.** The engine owns scoring for live-v3 mode. Direct-source reconstruction should calculate the same score for equivalent contest inputs, so its Go and browser fallbacks are aligned too. Exclude `850d64ab` as originally written from upstream proposals and retain the duration-based correction. The sampled API results support this restoration, including the 135-minute rounding behavior; they do not prove the formula covers every historical or custom contest rule.

The published default rules describe a fixed decay and permit round-specific modifications. That default is not proof that all historical round lengths follow it. [Official rules](https://codeforces.com/blog/entry/4088).

### 6.4 `3b42675f` — give skipped and challenged submissions zero points

[Full commit](https://github.com/mc-cari/live-v3/commit/3b42675ff708fef66573a5d3f65835b58e8fcecd)

**Purpose.** Avoid awarding a successful-solution score to submissions that have been superseded or invalidated.

**Before.** In the CF branch, the parser excluded `OK`, `CHALLENGED`, and `SKIPPED` from its “wrong” condition. As a result, an isolated skipped or challenged submission at minute 10 could receive 480 points in the fixture, despite not being a valid accepted solution.

**After.** Only `OK` receives an accepted score in that branch; the other verdicts receive zero. Pending verdicts take a separate in-progress path.

**Evidence.** Audit E1 demonstrates 480 for both invalidated verdicts in the original parser and zero in the current parser. Existing integration tests also cover an accepted run later becoming challenged. The added full-sequence integration test starts with one wrong attempt and an accepted solution worth 430 points. A later reload changes that acceptance to `SKIPPED` and supplies a replacement acceptance at minute 20. It verifies the skipped run scores zero, the replacement scores 410 (one 50-point deduction), and the calculated scoreboard selects 410. A subsequent partial reload retains that result.

**Ownership and recommendation.** Keep upstream. This is a general conversion/scoring defect. The superseded-acceptance sequence now covers both scoreboard selection and deductions: `SKIPPED` earns zero and contributes no extra wrong-attempt deduction, while a real wrong attempt still deducts 50 points. The existing challenged-update test covers invalidation to zero; this added sequence does not establish every later-attempt deduction rule for challenged submissions.

### 6.5 `702ffa04` — recover problem points from contest standings

[Full commit](https://github.com/mc-cari/live-v3/commit/702ffa04f640180aea4ad20bb2d92bacaa53aaf2)

**Purpose.** Avoid a parser exception when the submission's embedded problem lacks a maximum point value. The commit also changes which score is considered authoritative.

**Before.** The CF scoring branch dereferenced `submission.problem.points` as required, even though the source object allows the field to be absent. An absent value caused a null-pointer exception. Scores were calculated locally.

**After.** It first looks for the maximum in the contest's problem list, then in the submission's embedded problem. If both are absent it raises an explicit missing-points error. Separately, a positive `submission.points` value now takes precedence over local calculation.

**Evidence.** Audit E1 supplies an accepted submission with no embedded maximum while the standings still contain it. Original: null-pointer exception. Current: 480 points. The checked-in focused test covers this fallback. It does not test conflicting maximum values or the new supplied-score precedence. In particular, the current implementation checks for a maximum before using supplied points, so it still cannot rely on supplied points alone if both maximum sources are absent.

**Ownership and recommendation.** Split the commit. The missing-maximum fallback is general parser hardening and belongs upstream. Prefer-supplied-score behavior also belongs in source interpretation if correct, but needs its own evidence for CF-format contests, zero/absent values, conflicting data, and rejudging. The API describes submission points for IOI-like contests; it should not be assumed to be a universal authoritative CF score without validation. [API object reference](https://codeforces.com/apiHelp/objects).

This issue is not a reason to add application-specific score reconstruction to the adapter.

### 6.6 `36c5cf9a` — honor extended ICPC wrong-attempt penalties

[Amended commit](https://github.com/mc-cari/live-v3/commit/36c5cf9a7326aca6abac5e97cd4f604819fa8d72) (previously `e0837f40`; descendants were replayed, with the final engine tip now `2f45141a`).

**Purpose.** Correct the penalty setting used by the engine for Codeforces ICPC-format contests, including Educational rounds.

**Before.** `ContestInfo` inherited the engine's twenty-minute wrong-attempt default. One wrong attempt followed by acceptance at minute 3 therefore produced 23 penalty minutes.

**After.** The Codeforces parser looks for an official solved problem with wrong attempts, a best-submission time, and a problem penalty. It calculates `(problemPenalty - floor(acceptedSeconds / 60)) / rejectedAttempts`. If there is no usable evidence, it defaults to ten minutes for IDs below 100000 and twenty minutes otherwise.

**Evidence for the problem.** Educational Round 193 explicitly specifies a ten-minute incorrect-submission penalty. The current plugin tests demonstrate 13 total penalty minutes for the minute-3 example. They do not establish that every field in the Go CLICS projection represents per-problem penalties correctly. [Organizer's rules](https://codeforces.com/blog/entry/155718?locale=en).

**Evidence limiting the implementation.** Audit E5 supplies a custom Gym problem result implying seven minutes per wrong attempt. The parser infers seven. A subsequent standings response without that row resets the setting to twenty. This is a synthetic counterexample to stable inference, not a claim that a particular real Gym round uses seven minutes. The ID boundary and the first eligible observation are heuristics, not a complete rules definition supplied by the API.

**Ownership and recommendation.** The engine must apply the correct contest rules, so the correction belongs upstream. Revise the implementation before treating it as general support: define an explicit override, distinguish observed rules from defaults, retain a reliable learned setting across responses without evidence, and handle conflicting observations deliberately. The adapter can supply deployment configuration or a known override through a supported interface; it should not calculate a different total penalty from the engine.

Learning settings from official standings may also be insufficient for a cold start containing only unofficial participants. That is a design limitation, not a measured case in this audit. Tests for Educational rounds do not establish support for every Gym rule set.

**Penalty inference follow-up (2026-11-01), incorporated into the amended 6.6 commit.** Both the direct Go provider and the Codeforces plugin now infer from official **row totals**: subtract the sum of solved-problem acceptance times rounded down to minutes, then divide by the sum of rejected attempts on those solved problems. This uses fields present in real public API responses, rather than requiring optional per-problem penalties. Rows without positive best-submission timestamps, with inconsistent solved counts, or with negative/non-integral residuals do not supply evidence. A zero-minute rule is a valid observed or explicit value.

A new rule is learned only when all usable observations agree. Once learned, it survives missing and conflicting later observations for the same contest. Explicit `penaltyPerWrongAttemptMinutes` in the engine's CF settings takes precedence. The Go service exposes the same override for both sources through `CF_ICPC_PENALTY_OVERRIDES`, a JSON object mapping contest IDs to nonnegative minute values. Defaults remain ten minutes below ID 100000 and twenty otherwise; these are fallback heuristics, never recorded as learned evidence. Friend filtering happens after learning, so an unselected official row can establish the rule for a selected unofficial participant.

The direct Go fallback previously hardcoded twenty minutes. It now uses the resolved rule and persists learned/explicit settings with its SQLite standings view. The live-v3 parser retains its rule across reloads for the worker's lifetime; worker replacement can still require new evidence or an explicit override because there is no durable engine rule store. The browser's independent direct-polling fallback remains a separate implementation.

Focused Go/Kotlin tests cover agreement, conflicts, missing evidence, overrides (including zero), and contest isolation. The optional Go HTTP/SSE E2E regression replays a clearly labeled synthetic Gym scenario against **both actual engines**: learn seven minutes from a row without per-problem penalties, omit the supporting row, then supply conflicting nine-minute evidence. Selected unofficial scores retain the seven-minute rule, and a second run verifies an explicit five-minute override. These checks address rule stability; they do not repair incomplete/wrong rejection counts or establish every Gym scoring rule.

### 6.7 `f412c08b` — accept the pending SUBMITTED verdict

[Full commit](https://github.com/mc-cari/live-v3/commit/f412c08bfe1c42b3e61292e19b860052917745f7)

**Purpose.** Allow a queued submission to be read before the judge starts or finishes testing it.

**Before.** The API's documented `SUBMITTED` value was absent from the plugin's verdict enumeration. Deserializing that value failed. The failure could reject a response containing otherwise valid submissions.

**After.** The enum accepts it, the processed verdict is unfinished, and the scoring conversion emits `RunResult.InProgress`. A later observation for the same submission can replace it with a judged result.

**Evidence.** Audit E1 demonstrates the original serialization exception and the current in-progress run. The integration test also changes it to `OK` and verifies the subsequent score. The value is listed in the [primary API documentation](https://codeforces.com/apiHelp/objects).

**Ownership and recommendation.** Keep upstream. This is source compatibility, not a backend-specific requirement. It requires no persistence hooks, raw metadata export, or viewer filtering.

### 6.8 `f1d25e38` — preserve custom metadata on contest runs

[Full commit](https://github.com/mc-cari/live-v3/commit/f1d25e38ea7b666578f531843124eaae90fea4a7)

**Purpose.** Preserve source fields absent from normalized engine run objects, including exact Codeforces verdict/test/resource fields. The converter exports these fields through CLICS, and Go interprets them for the frontend.

**Change.** Add `customFields: Map<String, String>` to the core `RunInfo` data class. A map associates string keys with string values. Update its exported binary signatures and generated TypeScript representation. Later Codeforces changes put serialized source objects in this map.

**Independence.** The field is generic enough for other plugins to use. That makes it a possible feature, not proof of a pre-existing bug. The immediate need comes from our compatibility projection.

**Compatibility implications.** Adding a default field can be convenient for source callers, but the checked-in ABI diff changes constructors and generated `copy` signatures. Older compiled consumers are not proven compatible. Regenerating the signature reference and passing API checks does not erase that obligation. Repeatedly carrying serialized raw data through engine states also has memory/serialization implications that have not been quantified here.

**Current ownership and recommendation.** The implemented boundary retains this generic field in the fork and exposes it through optional CLICS metadata. Go interprets source-specific values; the exporter does not know our frontend contract. Propose the core-model capability separately, with compatibility and data-volume expectations. It is a feature decision, not a prerequisite for ordinary parser bug fixes.

**Actual dependency.** The exporter reads `RunInfo.customFields`; Go reads their CLICS representation. Removing the field without replacing the metadata route would lose exact submission test/verdict/resource fields. This is a dependency of the optional export stack, not of `SUBMITTED`, invalidated-verdict, or missing-maximum corrections. A sidecar redesign remains an alternative, not the currently implemented integration.

### 6.9 `d2852459` — discover eligible individuals and preserve source metadata

[Full commit](https://github.com/mc-cari/live-v3/commit/d28524592a93c4ab23754fb3fdf3cf3fe276f7d1)

**Purpose.** Support individual friends absent from official standings, preserve source information for our compatibility API, and make participant identities consistent.

**Why it needs splitting.** This commit changes several different behaviors:

| Part | What it changes | Recommended owner |
| --- | --- | --- |
| Identity normalization | Lowercases individual handle IDs and groups submissions by normalized team ID plus problem index instead of the entire source party/problem object. | Candidate upstream correction. Separate it and test changed party fields and existing ID references. Lowercasing IDs can affect consumers, so do not call it compatibility-free. |
| Participant discovery | Adds participants from retained submissions and hacks, rather than relying only on standings rows. | Potential general plugin capability. Official missing-participant handling and optional unofficial support deserve separate tests and proposals. |
| Unofficial inclusion | Adds an option to include `OUT_OF_COMPETITION`, retaining an out-of-contest flag. | Optional source capability; our adapter chooses whether a given viewer/product includes those participants. Not an existing official-only feature's bug. |
| Individual-only eligibility | Excludes teams when configured. | Our product policy; prefer adapter input selection. |
| Time-window filtering | Excludes submissions outside the contest window and adds lower-bound/type checks for hacks. | Candidate upstream rule correction, separated from friend-view requirements and validated for other supported formats. |
| Raw metadata export | Serializes contest/problem, party, submission, and hack objects into custom fields. | Retained plugin feature, now carried by generic CLICS exports and interpreted in Go. Propose separately from identity/scoring corrections; do not embed the frontend schema in the exporter. |
| Compact cached metadata | Caches contest/problem metadata without full standings rows. | A sensible implementation detail of the new metadata feature, not a pre-existing upstream performance defect. |
| Display names / refresh precedence | Preserves real-name fallbacks and lets newer official standings metadata win over older source payloads. | Required correctness of this participant rewrite. The original implementation already preserved names and rebuilt participants from standings; the regressions originated in our changes. |

**Evidence.** Existing integration tests cover unofficial discovery, case variants, an unofficial participant becoming official, out-of-window submission exclusion, hack metadata, compact metadata, and name-refresh precedence. That coverage does not isolate every row above against the original engine or validate all team/Gym configurations.

**Independence question.** Normalizing identity and grouping by stable identifiers can help ordinary users. Exporting original Codeforces JSON specifically so our frontend can receive its old object shape comes from our adapter. These should not be justified together.

**Recommendation.** Split the generic conversion fixes into small upstream commits with focused before/after tests. Keep viewer/product selection and interpretation of Codeforces-specific metadata in our Go adapter. The current plugin metadata production is a separate optional feature, not an independent correctness fix. If unofficial support is offered upstream, make its semantics explicit and optional, without coupling it to our friends list, checkpoint format, or HTTP response shape.

The ID change needs particular care during migration: use the same canonical identity for engine teams, sidecar joins, restored snapshots, and requested handles. Preserve the original presentation spelling separately.

### 6.10 `7820d537` — expose durable ingestion and reload observation hooks

[Full commit](https://github.com/mc-cari/live-v3/commit/7820d537c5c85f724a2f4a57b0234d60498292b8)

**Current behavior.** The plugin exposes a configurable acquisition source with public embedding hooks. The standard converter uses this source through `CFSettings.toDataSource()`; the Go application consumes CLICS and does not call the hooks directly.

**Before.** An internal `CFDataSource` extended `FullReloadContestDataSource`, used the existing loaders, and returned a parsed batch each poll. The shared reload implementation controlled how that batch became events.

**After.** `CFSettings.toDataSource()` uses a new public `createSource()` and a new manually implemented event flow. This is a replacement of the existing source path, not merely an additional opt-in helper. It also changes generated settings constructors because API credentials now have defaults.

| Available source capability | Current use and upstream boundary |
| --- | --- |
| `CFHistoryStore`, `read`, `merge`, and the in-memory implementation | Acquisition retention remains inside the converter. Go stores application views and does not supply a durable engine-history implementation. Raw-history hooks are separate from the parser omission fix. |
| `baseUrl` | Exposed through standard settings by `e03fc8e1`; Go configures it when starting the worker. Propose the generic setting separately from source replacement/hooks. |
| Anonymous public mode and optional credentials | Configure the converter's Codeforces access mode. This is a potential independent plugin feature with credential-validation and settings-compatibility obligations. |
| `interval`, `beforeRequest`, fresh connections | Available source controls; the Go integration uses converter defaults rather than calling these hooks. Generic polling/transport configuration can be proposed separately. No latency improvement is established. |
| `onReload(restored)` | Available synchronous-source callback, unused by Go. Go publishes after matching a CLICS scoreboard watermark, which is not a whole-reload transaction boundary. |
| `onFailure` | Available source error callback. Its behavior must preserve source compatibility, cancellation, and retry semantics; Go separately handles worker/CLICS failures. |
| `onRequest`, `onHistory` | Available observation hooks, unused by the Go integration. Their public API is not a prerequisite for the smaller parser fixes. |
| `supportedTypes` | Optional source restriction, unused by Go's standard converter configuration. Product support policy is separate from parser correctness. |
| `includeUnofficial`, `individualsOnly` | Separate source capabilities from viewer policy. Go enables supported unofficial inclusion; friend filtering remains in the application. |

**Existing tests.** They check history upserts, anonymous URLs, dedicated connections, completion after synchronous events, credential validation, restoration failures, and cancellation. Cancellation means intentionally stopping asynchronous work; it must propagate rather than be treated as a retriable failure.

Anonymous-URL tests prove the generated request shape, not that every real Codeforces endpoint permits anonymous access in every live-contest phase. Validate endpoint access requirements separately before making that broader operational claim.

**Retained source regression, audit E4.** The replacement source emits contest information before saved runs. For a restored `FINISHED` contest that means an `OVER` event is seen while the consumer knows no pending runs. `autoFinalize()` immediately finalizes and stops the flow, so the saved submission is never delivered. The original `FullReloadContestDataSource` deliberately emits a temporary running status for the first over batch, emits the runs, and then emits `OVER`; the same one-run case reaches the consumer there.

This remains relevant even though the current converter is explicitly run with `--no-auto-finalize`. `toDataSource()` now redirects ordinary plugin users to the replacement, so adapter-driven changes affect existing live-v3 behavior.

**Additional contract considerations.** The completion callback is only meaningful for a synchronous pipeline. Adding an asynchronous buffer can make it run before the actual consumer finishes. The settings ABI also removes old credential-taking constructor/function signatures. These are API and sequencing changes, not merely new optional parameters.

**Current ownership and recommendation.** Acquisition and in-memory retention now remain inside live-v3's standard converter. Go owns process supervision, application persistence, viewer policy, and publication after CLICS reconciliation. It does not call `CFHistoryStore`, `beforeRequest`, `onReload`, `onRequest`, or `onHistory`. The public hooks remain in the fork and have not been removed merely because the app stopped embedding them.

Do not submit this whole replacement as a dependency of the smaller parser fixes. Extract optional public-mode/base-URL configuration where useful, against the ordinary upstream source path. If source replacement is proposed, fix E4 and test existing final-state helpers and settings compatibility independently. A new conversion bridge is no longer required by the Go integration.

### 6.11 `f310cc41` — include safe diagnostics in reload failure logs

[Full commit](https://github.com/mc-cari/live-v3/commit/f310cc418f4c8f308186945783542bbd3eb7bdad)

**Purpose.** Distinguish failures of the same exception class without printing signed URL parameters.

**Before.** The new source's default failure handler logged only the exception class name. Different illegal-state failures looked identical.

**After.** It includes the exception message but removes everything from its first `?` onward. The associated test checks an HTTP failure description, a signed-looking URL, and a missing message. It verifies that the sample secret/signature do not appear.

**Ownership.** The deficient default handler was introduced by `7820d537`. The original reload source used its existing logger and passed the exception. This commit is therefore a fix to the integration source, not a separately discovered original live-v3 bug.

**Recommendation.** Keep it with the replacement source currently retained in the fork. It is not a reason to require that replacement in an otherwise independent upstream bug-fix PR. More complete redaction may be needed for credentials outside a URL query, but the existing test does not establish a universal secret-scrubbing guarantee. Avoid logging exception stacks indiscriminately if their messages can contain credentials.

### 6.12 `e03fc8e1` — optional CLICS metadata, synchronization, and unofficial scoreboards

[Full commit](https://github.com/mc-cari/live-v3/commit/e03fc8e1cd9cd4a6d64084c904dae0c298ae8b10)

**Purpose.** Expose native metadata, synchronization information, and supported unofficial standings through the standard converter. The exporter remains generic; only Go interprets `codeforces.*` metadata for the frontend.

| Part in this commit | Current behavior | Upstream proposal boundary |
| --- | --- | --- |
| Native metadata and judging progress | `event-feed?x_live=true` carries feed identity; contest/team/submission events also carry native custom fields, and submissions include the native judging result. Metadata changes participate in event comparison. | Optional generic export feature. Run metadata currently depends on `f1d25e38`; exact CF metadata additionally depends on `d2852459`. Do not pull those into unrelated parser fixes. |
| Feed identity and scoreboard watermark | A generator has a unique lifetime ID. An extended scoreboard captures calculated state and the last corresponding emitted event token together, after producing that state's events. | Separate synchronization feature, or explicitly stacked on a minimal extension-envelope proposal. Its core contract needs no Codeforces fields or friend lists. |
| Supported unofficial scoreboard rows | `include_unofficial=true` reuses calculated rows and the engine comparator to expose ranks/ties across eligible exported entries, without changing default eligibility. | Separately extractable generic scoreboard feature; it should build without CF discovery, native run metadata, or the Go app. A CF-specific source option is not a prerequisite for other sources with unofficial teams. |
| Codeforces `baseUrl` setting | Exposes an alternate API endpoint through standard settings and regenerates the plugin API declaration. | Separate generic plugin configuration proposal. The current wiring calls `createSource()` from `7820d537`; port it to the upstream source rather than requiring the whole replacement. |
| Codeforces `includeUnofficial` setting | Exposes the existing fork participant capability through standard settings, defaulting to false. | Stack on a separately reviewed participant-capability proposal, or hold in the fork. Not independent of `d2852459` as currently implemented. |
| Submission/judgement comparison cache | Records the latest emitted pair in the generator; the earlier map was read but never populated. | Candidate standalone exporter deduplication fix. Extract the assignment and add an isolated before/after duplicate-run test without native metadata. Code inspection identifies the issue; the existing two exporter tests do not establish a separate upstream baseline regression result. |
| Eager initialization ordering | Starts the shared event feed after the generator's maps and current-state storage have initialized. | Preserve with the generator change. A claim of a distinct pre-existing race requires its own reproducible evidence; do not advertise it as an independently proven bug yet. |

**Tests and limits.** Two generic converter tests cover default versus optional unofficial eligibility/tie ranks, extended scoreboard fields, absence of `x_live` from the default scoreboard, and native progress changes with identical standard submission data. The real-converter Go fixture additionally exercises exact test 22 → 23 changes and replay behavior. These are tests of the combined fork/application stack, not proof that every row above can already be cherry-picked and tested on the upstream base.

**Synchronization limit.** The watermark identifies a calculated scoreboard/event state. It is not a whole-Codeforces-reload transaction boundary, a durable event-history guarantee, or a complete restart recovery log. Go retains the previous view as stale while reconciling a fresh feed. This does not reconstruct engine acquisition history lost at worker restart.

**Recommendation.** Keep the working integration commit and pushed history intact. Prepare new, focused upstream branches for the selected units in section 11. In particular, do not make acceptance of unofficial rows require acceptance of CF metadata, persistence hooks, all scoring changes, or our application.

## 7. Current Go application

[Implementation commit `590f7ca`](https://github.com/mc-cari/codeforces-live-standings/commit/590f7ca)

The application has these boundaries:

- `ContestSource.InitialUpdate` supplies a normalized initial view; `StreamingGateway` supplies authoritative streaming views. Both providers use the same manager/session and public transport.
- Go's scoped SQLite repository stores normalized entities and complete standings/submission views by source and contest. This is application-view persistence, not a durable Codeforces acquisition log for the worker.
- The CLICS adapter upserts changed entities, skips identical content, applies explicit deletions, and retains omitted replay entities. It coalesces scoreboard requests and consumes staged events through the matching watermark before publishing a replacement snapshot. Feed-instance mismatch requires reconciliation again.
- Go automatically starts one standard converter per active contest. Worker defaults include a sixty-second readiness deadline and a three-worker limit; failed streams restart with backoff bounded at thirty seconds. Active restored views are stale until reconciliation. Retained finished views need no worker.
- Shared projection preserves live-v3 scores, row order, and tie information; it derives friend positions without recalculating those scores. The direct source retains its missing-row fallback. Queue overflow and capped-view transitions use replacement snapshots where patches cannot safely express the result.
- The frontend's SSE path preserves server rows, positions, and solved counts and honors snapshot removals. It does not apply the direct-polling merge/scoring fallback. DTO mapping preserves Go's decoration fields.
- `backend/Dockerfile.live-v3`, Compose, and compatibility CI package and exercise Go plus a JVM and the standard converter distribution. Worker supervision uses child processes and requires no runtime Docker-daemon connection.

**Upstream status.** Every item in this subsection belongs to the application repository. None is needed to demonstrate `SUBMITTED`, invalidated-verdict, missing-maximum, or in-process attempt-retention fixes in live-v3. The converter extension is a separate optional dependency of this deployment, not a reason to submit the whole fork upstream.

## 8. Current ownership of application concerns

These responsibilities remain in the Go application and must be excluded from independent upstream live-v3 proposals:

| Concern | Current owner and required behavior |
| --- | --- |
| Activation and capacity | Go manager: one session per contest, shared across browsers, with bounded active-contest capacity. |
| Worker lifecycle | Go adapter: configuration, private listener, readiness, bounded restart backoff, cancellation, and shutdown. |
| Durable application state | Scoped Go SQLite records: normalized observed entities, complete calculated views, revisions, completion, and retention. |
| Replay publication | Go adapter/session: retain stale published state until events match a scoreboard watermark from the same feed instance. |
| Friend selection and positions | Shared Go projection: filter without changing source scores, ordering, or tie distinctions. |
| SSE admission and disconnects | Go transport/session: limit streams and remove subscriptions when they close. |
| Backpressure, deletions, and display limits | Replacement snapshots when patches cannot represent the complete current view; cap only after friend selection. |
| Frontend compatibility | Preserve server decorations and snapshot removals in the SSE path; keep the direct-polling fallback separate. |
| Telemetry and deployment | Go application metrics/receipts, Compose, combined-image packaging, and compatibility CI. |

Source-specific metadata production and generic CLICS transport are separate live-v3 features. Their existence does not move browser contracts, SQLite policy, friend lists, or application telemetry into the engine.

## 9. Evidence: what was tested, and what each result proves

### 9.1 Before/after audit ledger

The included runner executes **17 characterization test cases** across four engine revisions. All reproduced their expected observations. They use real engine classes with deterministic fixture input. They do not require a running Codeforces contest.

| Evidence | Experiment | Observation | Scope of conclusion |
| --- | --- | --- | --- |
| E1 | Original vs current parser, four test methods | Omitted attempt: 480 vs 430; invalidated verdicts: 480 vs 0; missing maximum: exception vs fallback; `SUBMITTED`: decoding exception vs pending run. | These local conversion failures and fixes are reproduced. Frequency in real traffic is not measured. |
| E2 | Original reload pipeline with original vs changed phase mapping | Ordinary polling receives the rejudge in both cases. Auto-finalizing consumer misses it before the fix and receives it afterward. | The premature-finalization issue is real when that transformation is enabled. It is not a universal statement that `OVER` stops polling. |
| E3 | Parser inputs reconstructed from a published long-round result | Original formula: 489. Changed formula: 486. Published answer: 489. | A counterexample to universal duration independence. It does not prove a universal replacement formula. |
| E4 | Original finished-batch emission vs replacement source restoring finished history, both auto-finalized | Original delivers one run; replacement delivers zero despite one saved run. | A replacement-source compatibility regression, avoided by the application's disabled-auto-finalization configuration rather than fixed by it. |
| E5 | Current parser observes a custom penalty, then receives no supporting row | Seven-minute inference becomes the twenty-minute fallback. | The implementation does not preserve learned rules through missing evidence. The seven-minute Gym example is synthetic. |

The [five Kotlin audit files](evidence/live-v3-commit-review/) and [JSON observations](evidence/live-v3-commit-review/audit-results.json) preserve these checks. E4's original-source test supplies a parsed batch to the real original reload wrapper, rather than running the credentialed original network loader; it isolates batch emission order. Its replacement-source test runs the real public source with saved history, before any network call is needed.

### 9.2 Latest integration validation and its limits

The implementation session for `e03fc8e1` / `590f7ca` reported the following local results. This documentation edit checks the code/history and updates the account; it does not claim another execution of those suites.

| Validation | Result recorded during implementation | What it establishes |
| --- | --- | --- |
| Standard converter | 2 generic exporter tests pass; `installDist` succeeds. | Optional export/tie behavior and native progress emission in the tested cases. |
| Engine/plugin | 26 Codeforces tests, 10 core tests, and plugin/core API checks pass. | Existing regression coverage and agreement with approved API declarations; not universal scoring correctness or proof of old binary compatibility. |
| Go | Full race suite passes, including the controlled real-converter fixture. | Shared sessions, scoped views/entities, friend projection, replay reconciliation, worker lifecycle, and public transport work in the tested scenarios. |
| Real-converter fixture | Two friend lists share one worker; unofficial ties, test 22 → 23, final verdicts, rejudging, score changes, an omitted older submission, stale restart recovery, and application restore pass. | End-to-end behavior against synthetic, controlled Codeforces input—not independent published-score evidence for every scoring format. |
| Targeted Go cases | Duplicate/changed entity IDs, explicit deletion, replay through a matching watermark, feed-instance mismatch, capacity/readiness failure, persisted stale/finished views, and shutdown pass. | Covered normalization, reconciliation, persistence, and lifecycle cases; not an exhaustive fault model. |
| Frontend | 51 unit tests, type checks using `--ignoreDeprecations 6.0`, ESLint, and 4 desktop/mobile SSE browser tests pass. | SSE preserves server decorations/deletions and remains compatible with the tested UI flows. The flag acknowledges the existing TypeScript `baseUrl` deprecation. |
| Deployment | Compose validates; the Go/JVM 17 image builds. A container smoke test activates a real converter and receives SSE with exact test count 23 and memory 1234 bytes; recorded shutdown is 0.11 seconds. | The combined image runs the public entrypoint, worker, and SSE path in that fixture. The checked deployment uses the pinned standard converter distribution. |

The current synthetic integration fixture does not establish universal scoring correctness or overturn audit E3's published-score counterexample. Test counts describe the reviewed revisions, not all possible contest formats or failure modes.

The audit runner still pins its `current_fork` comparison to `f310cc41`. The new exporter/settings commit does not modify the earlier scoring formula or replace the audited source implementation. The reviewed scoring/source findings remain relevant because the current head retains those implementations; a green integration suite does not establish that the findings are resolved.

**Independence remains to be validated separately.** The successful combined fork suite is not a substitute for building each proposed upstream patch on its declared base without unrelated unmerged changes. None of the clean proposal branches in section 11 has been created or validated by this documentation update.

### 9.3 Reproduce the evidence and integration checks

From the application repository root, with its pinned engine checkout initialized, Python 3, a suitable Java installation, and access to the build dependencies:

```sh
python3 docs/reviews/evidence/live-v3-commit-review/run_audits.py
```

The runner creates disposable Git worktrees for the original base, phase fix, decay change, and audited `f310cc41` fork snapshot. It copies the shared fixture helper and only the audit tests needed for each revision, runs selected tests, writes JSON observations, and removes the temporary worktrees. It does not change the production engine checkout. RTK is used if installed, but is not required by readers.

Optional explicit paths:

```sh
python3 docs/reviews/evidence/live-v3-commit-review/run_audits.py \
  --engine /absolute/path/to/live-v3 \
  --output /tmp/live-v3-audit-results.json
```

The relevant commits must exist in that local Git object database; a shallow or unrelated clone may need the fork's history fetched first. Characterization tests deliberately assert some broken outputs so that changes in observations are visible. Convert them into desired-behavior regression tests when implementing the corrections.

Current integration commands, from the application repository root:

```sh
cd vendor/live-v3
./gradlew --no-daemon :cds-converter:test :cds-converter:installDist \
  :cds:plugins:codeforces:test :cds:core:test \
  :cds:plugins:codeforces:apiCheck :cds:core:apiCheck \
  -Plive.dev.embedFrontend=false
cd ../../backend
LIVE_V3_TEST_BINARY="$PWD/../vendor/live-v3/src/cds-converter/build/install/cds-converter/bin/cds-converter" \
  go test -race ./... -count=1 -timeout=120s
cd ../frontend
pnpm test:unit
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
pnpm lint
pnpm exec playwright test --config playwright.sse.config.ts
cd ..
docker compose -f docker-compose.live-v3.yml config --quiet
docker build -f backend/Dockerfile.live-v3 -t live-v3-backend:test .
```

Initialize the pinned submodule first; frontend dependencies and Playwright Chromium must be installed. Without `LIVE_V3_TEST_BINARY`, the real-converter Go test skips. The current CI definition also starts the combined container, checks `/healthz`, and stops it. The richer activation/SSE container smoke result above was a separate implementation-session check, not an additional checked-in CI fixture. See [the application README](../../README.md#alternative-live-v3-engine) and [compatibility workflow](../../.github/workflows/live-v3.yml).

## 10. The implemented boundary and the fork dependencies it retains

Go consumes the standard CDS converter's CLICS API. Parser classes and Codeforces implementation types remain internal to live-v3. Go starts workers through their standard configuration and publishes views through the CLICS synchronization contract.

The generic exporter carries optional data; the Go adapter interprets it. For example, the source plugin produces native `codeforces.submission` metadata, CLICS transports it as a custom field, and Go recovers the exact verdict, test set/count, time, and memory fields. Calculated scores and ordering come from the scoreboard endpoint, not a second scoring implementation in Go. Native metadata should not be confused with the frontend schema: the converter has no friend lists, SSE revisions, browser contracts, or application telemetry.

### What stays in the fork for this integration

| Retained component | Why the current integration uses it | Upstream consequence |
| --- | --- | --- |
| Retained parser/scoring commits | Standard converter uses the fork's Codeforces plugin. | Integration success does not approve every scoring policy. Extract only the chosen correction and its tests. |
| `RunInfo.customFields` and CF native metadata | Preserve exact source fields absent from standard CLICS objects. | Optional metadata/model proposals have dependencies and ABI costs; ordinary parser fixes must not require them. |
| Replacement source | It is still the implementation behind `CFSettings.toDataSource()`. The app does not call its embedding hooks. | The source regression and compatibility questions remain. Unused hooks have not automatically become upstream requirements. |
| Generic CLICS extensions | Carry progress, supported unofficial standings, and a scoreboard/feed synchronization point. | Useful optional features, to be proposed separately or with disclosed prerequisites. |

### Recovery is application-view recovery

Go stores one complete observed contest view before projecting it for each browser. On failure or replay it retains that published view as stale. Incoming events are staged, IDs can be updated, explicit deletions are honored, and omission is not treated as deletion. A replacement view is published only after applying the events through a scoreboard watermark from the same feed instance.

On worker restart, the converter performs its current fresh source reload. Go's retained CLICS entities are **not** injected back into the engine as acquisition history. Therefore retained older submission metadata does not guarantee that a fresh worker can reconstruct the identical score if the upstream reload omits score-relevant history. The fresh calculated scoreboard remains authoritative. Neither this design nor the watermark can recover upstream changes never observed by either process.

A watermark also does not certify that an entire Codeforces polling batch has finished: the exporter works with calculated contest-update states. It solves matching event replay to a calculated scoreboard state, not source transaction boundaries or durable engine replay. Stronger guarantees would be a separate design proposal, not an implied property of this extension.

## 11. Submit focused upstream proposals independently

**Keep the working fork as an integration branch. Prepare selected proposals on new branches from an explicitly recorded upstream base.** Do not force-push or rewrite either existing PR merely to obtain a cleaner contribution series. A separate branch can port one change while preserving the original pushed history.

“Independent” means that a maintainer can review, build, test, and merge that proposal while rejecting or postponing every other unmerged proposal in this review. Separate commit messages alone do not meet that standard. If a feature genuinely requires another proposal, label it stacked and identify the prerequisite instead of calling it independent.

### 11.1 First candidates: small existing-behavior corrections

These are proposal units to prepare, **not already validated cherry-picks**. Each unit includes its own regression test. The order is suggested; acceptance of an earlier row must not be required by a later independent row.

| Proposal unit | Starting material | Scope and required evidence | Unmerged production dependencies allowed |
| --- | --- | --- | --- |
| U1 — Accept queued `SUBMITTED` verdicts | `f412c08b` | Enum acceptance and in-progress conversion; reproduce the decode failure on the upstream base, then test transition to a final verdict. | None. Do not import metadata, unofficial participants, history hooks, decay, or penalty changes. |
| U2 — Zero invalidated CF runs | `3b42675f` | Zero the score of `SKIPPED`/`CHALLENGED`; demonstrate the old nonzero result, then test invalidation/replacement sequences without broad scoring-policy changes. Keep attempt-deduction policy separate. | None. Use a two-hour fixture so the test does not assume `850d64ab`. |
| U3 — Recover a missing problem maximum | Fallback portion of `702ffa04` | Avoid the absent-embedded-maximum exception by reading the standings maximum. Test missing/both-missing values and document conflict precedence. Exclude the positive supplied-score precedence change. | None. Port only the fallback; the original commit combines two changes. |
| U4 — Retain omitted attempts in one parser lifetime | `493d0720` | Preserve a known wrong attempt across a partial response, update existing IDs during rejudging, and keep history scoped to one contest/parser. Address memory/lifetime and explicit invalidation semantics. | None. No SQLite, `CFHistoryStore`, callbacks, or restart durability. |
| U5 — Suppress duplicate CLICS run events | Comparison-cache assignment extracted from `e03fc8e1` | Add a standalone generator test: identical repeated run updates emit no duplicate submission/judgement; a genuine changed judgement still emits. Demonstrate the failure on the chosen base first. | None intended. Exclude native fields, `x_live`, unofficial ranking, and CF settings. This row is a code-review candidate, not yet a separately reproduced audit finding. |

The tests in `f412c08b`, `3b42675f`, and `702ffa04` currently call helpers introduced in `CFPartialHistoryTest.kt` by `493d0720`. **That is a test dependency, not evidence that the production fixes require retained history.** Make each proposal self-contained with the minimal fixture builders it needs, or land a genuinely neutral test-helper change first. Do not require acceptance of U4 simply to obtain JSON fixture functions. Later diffs also have context from earlier commits; a clean cherry-pick is neither guaranteed nor required—port and review the intended change.

U1 is the narrowest initial candidate. U2 and U3 can be prepared separately alongside it. U4 involves an explicit retention policy, so its independent implementation still deserves a fuller lifetime review. There is no need to wait for any CLICS feature proposal before sending an evidence-backed parser correction.

### 11.2 Separate policy work: hold or revise before proposing

| Unit | Why it is not ready as an unconditional standalone fix | Next step |
| --- | --- | --- |
| System-testing completion (`706a03d0`) | The auto-finalization failure is reproduced, but `RUNNING` may misrepresent an already closed coding window. | Agree on phase/finalization semantics; include ordinary polling, auto-finalization, and cold-finished event-order tests against the original source. Propose that correction independently of source replacement. |
| Duration-independent decay (`850d64ab`) | Published long-round evidence contradicts the claimed universal rule. | Hold or revise using actual score oracles. Do not include this commit because another fix happens to touch the scoring function. |
| Positive supplied-score precedence (part of `702ffa04`) | The missing-maximum regression does not validate score precedence. | Obtain CF-format evidence for positive, zero, absent, conflicting, and rejudged scores; propose separately if justified. |
| ICPC penalty inference/defaults (`e0837f40`) | Evidence-free later polls can erase inferred settings; ID-based defaults are heuristic. | Separate a demonstrated rule correction from inference policy. Define overrides, retention, confidence/conflict behavior, and real-contest validation. |
| Identity/grouping and contest-window changes (`d2852459`) | Potentially general corrections, but currently mixed with discovery, metadata, eligibility, and refresh behavior. | Extract each demonstrated issue and its baseline regression. Preserve existing IDs/references and display names deliberately. |
| Replacement source and hooks (`7820d537`, `f310cc41`) | A replacement-source regression and settings/API changes remain; logging fixes address that new component. | Keep in the fork for now. If proposed, review source compatibility and E4 explicitly; do not make small parser fixes depend on its persistence/observability hooks. |

### 11.3 Optional features: separate proposals, with honest dependencies

These can be useful to ordinary live-v3 users without being existing bugs. They need their own feature rationale and default-compatibility tests.

| Proposal unit | Can it be independent? | Dependencies and exclusions |
| --- | --- | --- |
| F1 — Generic unofficial scoreboard option | Yes, by extracting only the exporter option from `e03fc8e1` onto the upstream generator. | Use generic unofficial-team fixtures and existing calculated rows/comparator. No CF discovery, run metadata, `x_live`, SQLite, or Go requirement. Preserve default eligibility, group behavior, ordering, and ties. |
| F2 — Source public mode / alternate API URL | Potentially; extract narrow configuration units from `7820d537` / `e03fc8e1`. | Implement on the ordinary upstream source and test credential validation/request shape/settings compatibility. Do not require replacing the source or adding callbacks. Public mode and alternate URL can themselves be separate commits/proposals. |
| F3 — Generic run custom fields | A separate core-model feature proposal. | `f1d25e38` changes constructors/copy ABI and generated contracts. Address compatibility, absent-field defaults, and data volume. Not required by U1–U5 or F1. |
| F4 — Generic CLICS native metadata/progress | The current implementation is not independent of the run model extension. | Either stack on accepted F3 or agree on another metadata source. A narrower judging-progress-only export could use the existing `RunResult` without F3; validate that extraction separately. Use generic tests; CF raw-object population is a separate plugin feature. Do not require the entire CF source replacement. |
| F5 — Feed identity and scoreboard watermark | Separate synchronization proposal, or explicitly stacked on a small shared extension-envelope contract. | Define token scope and atomic state/watermark semantics; test concurrent updates/replay and instance reset. No CF custom fields, unofficial rows, raw-history store, or browser contract is inherently required. If sharing `x_live` with F4, disclose that packaging dependency. |
| F6 — Optional CF participant discovery/unofficial inclusion | Separate source capability, currently mixed into `d2852459`. | Define supported party types and source eligibility before exposing the `includeUnofficial` setting. It may need an identity fix, which must be named as a prerequisite. F1 does not depend on this CF-specific feature. |
| F7 — Native Codeforces custom-field population | Optional plugin metadata proposal, or retained fork-only. | Requires the agreed metadata model for each entity; exact run metadata currently needs F3. Go's interpretation, friend lists, and frontend-shaped responses stay outside live-v3. |

There is no proposed universal bundle of F1–F7. For example, F1 can be reviewed and accepted while F3/F4/F7 are postponed; U1 can be accepted while all optional features are rejected. Features sharing a small prerequisite may use an explicitly stacked PR, but should not quietly import the rest of the integration fork.

### 11.4 Acceptance gate for each independent proposal

1. Record the exact upstream base and the single problem or capability. Include a small trigger/before/after example and the supporting evidence.
2. Port only the required production change and its local fixtures/tests. Inspect the diff for unrelated decay/penalty rules, metadata fields, participant policy, callbacks, generated API changes, and application code.
3. For a correction, run the focused test on the unpatched base and show the expected failure; run it again with only that proposal and show the desired behavior. For a feature, demonstrate unchanged default behavior and its explicitly enabled behavior.
4. Build and run the affected module's tests and necessary API/schema checks on that isolated branch. Broaden coverage where the change crosses existing consumer boundaries, such as phase/finalization or core-model ABI.
5. State any prerequisite in the PR description. An unmerged production prerequisite makes it stacked; an unmerged unrelated helper should be eliminated or separated, not hidden.
6. Keep the integration branch and application pin working through normal follow-up commits when an upstream proposal lands or changes. Do not rewrite pushed history, and do not claim that an extraction is validated merely because the full fork suite passes.

**Work still required:** create and validate the chosen clean proposal branches. The existing 12-commit fork PR remains a working integration stack. This document now provides a contribution plan; it does not claim the stack has already been split into independent upstream PRs.

## 12. What can and cannot be concluded today

The current integration consists of the shared Go application, supervised standard converter workers, and the CLICS adapter. Generic exporter additions and Codeforces plugin changes remain in the fork, including the unresolved scoring/source-policy questions identified in this review.

Some corrections have before/after evidence suitable for narrowly scoped upstream work. Others are feature proposals with explicit prerequisites, or policy changes that need revision. The new exporter commit itself combines several such units. “Reusable in live-v3” and “ready to submit independently” are different conclusions.

The preferred next step is to select a small proposal such as U1, prepare it on a clean recorded upstream base, and validate it without the rest of the fork. Submit further independent proposals as their evidence is ready; do not require the main live-v3 project to adopt the whole integration at once.
