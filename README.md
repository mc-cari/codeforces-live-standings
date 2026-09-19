
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
named Cloudflare Tunnel.

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
