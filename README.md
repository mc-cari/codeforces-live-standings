
## Codeforces Live Standings

Website for a dynamic visualization for live standings of [Codeforces](https://codeforces.com) competitions for a custom selection of users, the submissions and standings are updated automatically. The style of the website is the one used for ICPC competitions ([ICPC World Finals Dhaka Standings](https://www.youtube.com/live/15Wyj_-PG9I?feature=share&t=10935)) because it has an interesting design.

[Contest 1735 replay demo](https://codeforces-live-standings.mccari.us/contests/1735/replay?contestType=normal&startTime=2%3A50&playbackSpeed=15&autoplay=true&demo=true&h=TWF0ZW9DVjttYy5fY2FyaTtkbWdhNDQ7TWFyY2tlc3M7anVsaWFuZmVycmVzO3BhY2hhMjg4MDtHaWdhX0Nyb25vczttYXJ0aW5zO21hcnRpbml1cztNYXRlbztNZXNTaW1vbkZhbGxvbjE5O1NjYW5vO0FnYXJpYztlc3RveS1yZS1zZWJhZG87VGFpbmVsO01hcmNlYW50YXN5O0FuZ3J5U2VhbA).

Website link: [Codeforces Live Standings](https://codeforces-live-standings.mccari.us/).

### Repository layout

- `frontend/` is the independently deployable Next.js application. It owns its package manifest,
  lockfile, tests, and Vercel configuration.
- `backend/` is the independently deployable Go live-streaming service. It owns its Go module and
  container image.
- `docker-compose.live.yml` is deployment infrastructure for the backend service.

### Architecture

The frontend uses pragmatic domain boundaries under `frontend/src/contexts`:

- `contest-setup` owns contest discovery, configuration, and participant selection.
- `live-standings` owns polling and immutable live projections.
- `replay` owns timeline configuration, scoring, and playback projections.
- `integrations/codeforces` is the anti-corruption layer around Codeforces DTOs and transport.

Next.js files in `pages` are route adapters. Context application ports describe external
capabilities, infrastructure adapters implement them, and shared code is limited to contest
timing, participant identity, party naming, and standings reconstruction.

It has support for:

  - Normal Rounds
  - Educational Rounds
  - Gym Contests (Teams are recognized by one of its members, due to the Codeforces API design)

The website works with old contests and live contests and also shows the practice submissions.

### Freeze, reveal, and share

Enable **Freeze standings** during setup to hide results from the last chosen number of minutes.
The cutoff is measured from contest start; submissions and hacks exactly at the cutoff are hidden too.
Amber cells show pending submission counts, while scores, ranks, and the submission feed use only
visible results. Freezing is a viewer presentation feature: source results remain available on
Codeforces and in the browser.

**Unfreeze now** shows all currently available results and persists that choice in the URL.
After a live contest finishes, or a replay reaches its end, **Start reveal** opens a bottom-up
ceremony. The lowest currently ranked participant with pending activity reveals problem cells in
problem order, then hacks in creation-time/ID order. A hack involving two selected participants
reveals and scores once. Use **Next**, or **Auto reveal** to advance every 1.5 seconds; **Pause** stops automatic
advancement. Reloading restarts the ceremony, and seeking a replay clears reveal progress.

Reveal normally waits for Codeforces `FINISHED` and settled verdicts for the selected participants'
contest submissions. A generic **Waiting for judging** indicator exposes no pending-submission
count. **Reveal anyway** becomes available after the contest ends, so a stuck submission or delayed
system testing can be bypassed manually. Results can still change after this override. Practice
submissions do not block reveal; live polling continues while contest verdicts remain pending.
Replay offers the same override at the end of its timeline.

**Share setup** copies a link from setup or either viewer. Links preserve the contest, selected
participants, `freezeMinutes`, and `freezeView=unfrozen` when used. Replay sharing also includes
the current playback time, speed, and play state. If clipboard access is unavailable, a selectable
link appears. Links without freeze settings retain the default unfrozen behavior; invalid freeze
parameters disable freezing and show a warning.

### Hacks and replay fidelity

The submissions panel also shows hacks involving either side of a selected participant or team.
CF contests award +100 for `HACK_SUCCESSFUL`, subtract 50 for `HACK_UNSUCCESSFUL`, and award zero
for other outcomes; ICPC contests receive no hack adjustment. These adjustments apply once to
the hacker. Defender scores come from their submissions' latest API verdicts, including
`CHALLENGED`; replay does not invent an earlier accepted verdict or retain verdict history.
See the [Codeforces scoring rules](https://codeforces.com/blog/entry/4088?locale=en).

Hacks use their creation time on the replay timeline. Events after the contest appear at its
terminal position with an **After contest** label. Frozen hacks expose neither their rows nor
their score/rank effects until revealed. A live viewer present before the cutoff retains one
in-memory official board as the freeze baseline, preserving observed points even when hack
details are missing. Late arrivals and replays reconstruct from available timestamped records.
Ordinary live standings, instant unfreeze, and completed reveals use authoritative totals.

Hack loading is optional. **Hack details may be incomplete** remains visible during live contests,
on fetch failure, or when selected participants' hack counts disagree with official standings.
Codeforces [publishes full hack details only after some delay](https://codeforces.com/apiHelp/methods#contest.hacks).
Live collection requests hacks initially and at most every 30 seconds through the existing
limiter; missing/inconsistent final data is retried for up to 10 minutes. Replay provides **Retry**.
A frozen reveal with missing data retains its available projection until retry or unfreeze.
Latest records merge by ID in memory across partial/failed responses. Hack tests and judge
protocols are discarded, and database retention is unchanged.

[Codeforces blog post](https://codeforces.com/blog/entry/114892).

The wesite uses the [Codeforces API](https://codeforces.com/apiHelp) to get the data. During competitions, the API doesn't provide all the submissions, becuase they are beign updated at the same time, so the API responses are merged with the local status.

### Codeforces API credentials

From `frontend/`, create `.env.local` from `.env.example` and set `CF_API_KEY` and `CF_API_SECRET` to a
Codeforces API key pair.

You can get an API key from https://codeforces.com/settings/api.

The contest form can import friends for an authorized Codeforces account through
`user.friends` at any contest phase. Codeforces does not provide an anonymous or
arbitrary-handle friends endpoint, so the user must provide an API key and secret
from https://codeforces.com/settings/api. The browser signs the one-time request
directly to Codeforces; credentials are not sent to this app server or stored.

### Development

Set up the project with:

```sh
cd frontend
corepack enable
pnpm install
```

Start the development server with:

```sh
cd frontend
pnpm dev
```

Run domain and browser tests with:

```sh
cd frontend
pnpm test
```

The Playwright suite mocks Codeforces responses, covers desktop and mobile layouts, and verifies
that friend-import credentials are used only for the browser-to-Codeforces request.

### Optional real-Codeforces integration test

A saved public API fixture for [contest 566 — VK Cup 2015 Finals, online mirror](https://codeforces.com/contest/566)
contains `Misha100896`, `fruwajacybyk`, 18 relevant hacks, and 17 submissions (including three
latest `CHALLENGED` verdicts). Regular unit and browser tests use this fixture without network
access. They verify event timing, freeze/reveal, seeking, retry, and the official final scores
of **690** and **150**. Misha100896's 3 successful and 8 unsuccessful hacks contribute **−100**.

To optionally fetch current Codeforces data and compare reconstructed replay scores with the
current official standings (no API credentials required):

```sh
cd frontend
CF_LIVE_INTEGRATION=1 pnpm test:integration:codeforces
```

This test is excluded from `pnpm test`; without `CF_LIVE_INTEGRATION=1` it reports a skip.
It uses public `contest.standings`, `contest.hacks`, and per-handle `contest.status` requests,
paced at least 2.1 seconds apart. Upstream failures fail this opt-in check. It never rewrites
the saved fixture. Fixture provenance is recorded in `frontend/tests/fixtures/codeforces-566-hacks.json`.
To run only the saved-fixture browser cases: `pnpm exec playwright test tests/e2e/hacks.spec.ts`.

For manual testing, open the local replay at
`/contests/566/replay?contestType=normal&handles=Misha100896&handles=fruwajacybyk&autoplay=false`.
Seek to **27:57 → 27:58** for the first −50 adjustment, or **32:20 → 32:21** for a +100 adjustment.
Add `freezeMinutes=152&startTime=180` to try a final-position reveal.

### API behavior and caching

The browser calls the app's `/api/codeforces` backend. That backend uses one bulk
`contest.status` response and filters it locally for the requested handles. Within
each server instance, identical requests are shared and upstream requests
start at least 2.0 seconds apart. Cache hits do not enter that queue.

The limiter is process-local: separate Vercel instances cannot coordinate without a
shared service such as Redis or a database. Cached response bodies are bounded to
100 MiB per instance and use expiry plus LRU eviction, so old contest
responses do not accumulate indefinitely.

The demo replay is served from the versioned, immutable
`frontend/public/demo/1735-v1.json` snapshot and makes no Codeforces API requests.
Run:

```sh
cd frontend
pnpm generate-demo
```

### Live streaming backend

The live standings page can use the Go SSE backend by setting
`NEXT_PUBLIC_LIVE_API_BASE_URL` to its public URL. The backend is in `backend/` and can be
run locally with `cd backend && go run .` or deployed with `docker-compose.live.yml` behind a
named Cloudflare Tunnel. Local runs bind metrics to `127.0.0.1:9090` by default; set
`METRICS_LISTEN_ADDR` explicitly to a private-network address for remote scraping.
Compose sets `:9090` inside the container without publishing the metrics port.

For the Raspberry Pi deployment, copy the root `.env.example` to `.env`, set the tunnel token,
and start the stack:

```sh
cp .env.example .env
docker compose -f docker-compose.live.yml up -d --build
```

The tunnel should route its public hostname to `http://live-backend:8080`. The service exposes
`/healthz` and `/readyz` for health checks.

The backend keeps the active contest projection in memory and persists only new or changed
submissions plus activation metadata in SQLite. It deliberately does not rewrite the full
standings response on every poll; this keeps flash-storage writes bounded. Use an SSD for
continuous operation when possible. RAM/tmpfs may be used for transient data, but the
authoritative SQLite database should remain durable because Codeforces can omit older
submissions from later responses.

### Vercel deployment

Configure the existing Vercel project with `frontend` as its Root Directory under
**Settings → Build and Deployment**. Keep framework detection on Next.js and leave the output
directory at the framework default. The install/build commands are read from
`frontend/vercel.json`. Enable the Root Directory's "Skip deployment" option if backend-only
commits should not deploy the frontend.

Keep `NEXT_PUBLIC_LIVE_API_BASE_URL` in the Vercel project's environment variables and point it
at the separately deployed Go service. The Go backend is not part of the Vercel project.

### Usage metrics with Grafana Alloy

Optional production telemetry records page views, completed setups, displayed scoreboards,
countdowns, and basic loading reliability. Lifetime usage totals are persisted in SQLite;
Alloy scrapes a private metrics listener and forwards to your existing Grafana destination.
See [deployment, dashboard import, and metric definitions](monitoring/README.md).
