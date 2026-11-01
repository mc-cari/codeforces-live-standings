# Automatic collection admin

The independent `admin/` Astro application builds static HTML, CSS, and bundled TypeScript.
Go serves it and `/api/settings` (GET, PUT) and `/api/contests` (GET) exclusively on the
admin listener. Public port 8080 never mounts these handlers. The production image has
no Node runtime. Compose builds from the repository root and does not publish port 8081.

## Local development

Use Node 24, pnpm 11.14.0, and Go 1.25 or later. In separate terminals:

```sh
cd backend
DATA_DIR=/tmp/cf-live-admin ADMIN_DEV_MODE=true ADMIN_ORIGIN=http://localhost:4321 go run .
```

```sh
cd admin
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:4321. The Astro server proxies `/api` to `127.0.0.1:8081`.
`ADMIN_API_TARGET` can override that target. The backend's default admin bind is
`127.0.0.1:8081`; development authentication bypass only accepts loopback peers.
Use the exact origin above (including hostname and port) for writes.
`ADMIN_DEV_MODE` must never be enabled in production; Compose does not expose it.

## Production inputs

Set these only in the deployment environment or an untracked `.env`:

| Input | Value |
| --- | --- |
| `ADMIN_ORIGIN` | Exact admin origin, e.g. `https://standings-admin.example.com`, without trailing slash |
| `ADMIN_EMAIL` | Your single Google account email |
| `CF_ACCESS_TEAM_DOMAIN` | `https://YOUR-TEAM.cloudflareaccess.com` |
| `CF_ACCESS_AUDIENCE` | Application Audience (AUD) from the admin Access application |
| `CLOUDFLARE_ADMIN_TUNNEL_TOKEN` | Dedicated admin tunnel token, separate from the public tunnel |
| Google OAuth client | Client ID and secret configured in the Cloudflare Google identity provider |

`ADMIN_LISTEN_ADDR` defaults to loopback locally and is `:8081` in Docker.
`ADMIN_ASSETS_DIR` defaults to `../admin/dist` locally and `/opt/admin` in Docker.
None of the authentication values are Astro build inputs. Missing production
configuration returns 503; invalid or absent JWTs return 401 and other emails return 403.
Go checks the JWT signature, issuer, audience, expiration, and email using Cloudflare's
rotating public keys. Keys are fetched over HTTPS and cached by the OIDC library.

## Cloudflare setup before publishing

1. In Cloudflare Zero Trust, configure Google as an identity provider. Create the
   Google OAuth web client with the redirect URI shown by Cloudflare and store its
   client ID and client secret in the identity provider settings.
2. Create a self-hosted Access application covering the **whole admin hostname**,
   with no path restriction. Set session duration to **8 hours**, select only Google
   for login, and create one Allow policy whose Emails list contains only `ADMIN_EMAIL`.
   Do not add Bypass, Everyone, or domain-wide policies. Record the application's AUD.
3. Create a separate remotely managed tunnel for admin access. Before publishing the
   hostname route, enable **Protect with Access** and application token validation
   on the tunnel route. Set the Access team and the application's AUD in its Access
   origin settings. Route the admin hostname to `http://live-backend:8081`.
   Keep the existing public hostname routed to `http://live-backend:8080`.
4. Supply the deployment inputs, then start the admin tunnel profile:

   ```sh
   docker compose -f docker-compose.live.yml --profile admin up -d --build
   ```

The repository configures the tunnel connector; the Access application, Google
provider, email policy, hostname, and remote tunnel route must be configured in your
Cloudflare account. See [Cloudflare self-hosted apps](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
and [JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Collection behavior

Fresh databases default to **Off**. Selected contests and All public contests only
start sessions when fresh Codeforces standings report CODING, PENDING_SYSTEM_TEST,
or SYSTEM_TEST. Discovery uses `contest.list?gym=false` on the same paced client as
polling. It runs on startup, refreshes every 60 seconds while enabled, and refreshes
stale data when the admin requests status. A failed discovery never activates from
stale schedules. BEFORE contests remain idle even if their scheduled time has passed,
so postponed starts follow refreshed upstream phases and schedules.

Settings persist in SQLite. Changing mode or selection never cancels an existing
session, and restart restores active sessions even in Off mode. Selected IDs survive
mode changes and remain removable if they disappear from current discovery.

At most three sessions collect at once, shared with viewer activation. Eligible
contests are attempted by start time, then ID; capacity waits and activation failures
retry every 15 seconds while enabled. Existing sessions are never interrupted.
A complete poll fetches both standings and submissions. Sessions collect with no
viewers, retain accumulated history for late subscribers, and finish after two
successful FINISHED polls. Restored sessions send their full history once warmed.

The admin refreshes status every 15 seconds and keeps local unsaved settings intact.
It shows per-session collection state, last successful poll, latest poll/activation
error, discovery freshness, and capacity waits. The single Save button persists
settings before reconciliation; an upstream activation failure remains visible in
status and is retried without requiring another save.

Prometheus exports `cf_collection_waiting_contests` and
`cf_collection_activation_failures_total` (aggregate attempts, excluding capacity
waits). `cf_codeforces_request_duration_seconds` and
`cf_codeforces_rate_limit_wait_duration_seconds` also include method `contest.list`.

## Verification and rollout

```sh
cd backend && go test -race ./...
cd ../admin && pnpm build
pnpm exec playwright install chromium
pnpm test # serves the build through Go, including its Content Security Policy
cd .. && docker build -f backend/Dockerfile -t cf-live-admin .
python3 admin/scripts/smoke-image.py cf-live-admin
```

Automated tests cover settings validation/persistence, postponed starts, testing
phases, discovery and activation failures, capacity retry order, concurrent viewer
activation, zero-viewer polling, recovery in Off mode, late-subscriber history,
private routes, same-origin JSON writes, signed JWT authorization, saving/error
states, timed refresh with unsaved changes, and desktop/mobile layouts.

For deployment acceptance:

1. Start with Off and verify the page is inaccessible without Google login. Your
   account must succeed; a second Google account must be denied. Verify static
   assets and APIs are also protected, and the public hostname returns 404 for
   `/api/settings` and `/api/contests`. Cross-origin PUTs must return 403.
2. Select one running contest and Save. With no standings viewers connected, check
   that its last successful poll advances. Restart and verify the session resumes.
3. Join midway from the public standings application and verify accumulated history.
   Set Off and confirm the existing session still completes naturally.
4. Observe upstream pacing, errors, and waiting counts before considering All mode.
   Three contests generate ongoing upstream load; discovery and activations share
   the same limiter and may wait for in-flight polling.

Live Google login and tunnel policy checks require the real account configuration;
local signed-JWT tests validate the backend boundary, not Google's interactive flow.
