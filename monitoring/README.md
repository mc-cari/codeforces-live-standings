# Usage metrics

The browser sends predefined events to the same-origin Next.js `POST /api/telemetry`
proxy. The proxy authenticates to Go `POST /v1/telemetry` with a server-only bearer
token. SQLite commits an event receipt and any lifetime increment in one
transaction before acknowledging. Retries reuse an event ID; duplicates within
24 hours have no effect. Receipts are pruned hourly after 24 hours; aggregates
are kept indefinitely and are independent of contest cleanup.

The backend admits one telemetry write at a time, rejecting concurrent events
with HTTP 429 and `Retry-After: 1`. Each write uses the request context with a
2-second deadline, so disconnects and timeouts cancel queued database work.
Overload can drop usage events; delivery remains best effort.

## Production configuration

1. Generate a shared token with `openssl rand -hex 32`. Set `TELEMETRY_TOKEN` on
   both the Go service and the Next.js server. Never use a `NEXT_PUBLIC_` prefix
   for this token.
2. Set Next.js `NEXT_PUBLIC_LIVE_API_BASE_URL` to the reachable Go application
   URL, e.g. `https://your-live-backend.example.com`. The telemetry proxy uses
   this same URL server-side and forwards to `/v1/telemetry`; the browser still
   sends events only to the same-origin `/api/telemetry` route. Keep the
   Cloudflare tunnel route at `http://live-backend:8080`.
3. Redeploy the frontend after configuring the backend URL and shared token.
   Collection never blocks loading/navigation and makes at most three delivery
   attempts.
4. Set `ALLOY_NETWORK` to the existing Docker network containing Alloy
   (`grafanacloud_default` on the current host). Start:

   ```sh
   docker compose -f docker-compose.live.yml -f docker-compose.metrics.yml up -d --build
   ```

   The overlay attaches the backend with alias `cf-live-standings-metrics`. Its
   metrics listener is set to `:9090` (`METRICS_LISTEN_ADDR`); port 9090 is not
   published to the host and `/metrics` is absent from the public application
   listener. Direct runs default to `127.0.0.1:9090`; standalone containers
   must set `METRICS_LISTEN_ADDR=:9090` for network scraping. Only attach trusted
   services to the Alloy network.
5. Append [usage.alloy](usage.alloy) to the existing Alloy configuration at
   `/home/mc_cari/Projects/GrafanaCloud/config.alloy`, validate the complete
   configuration with `alloy validate`, then reload Alloy. It forwards to the
   existing `prometheus.remote_write.grafana_cloud` receiver. The job is
   `cf-live-standings` and the scrape interval is 15s.
   No separate Prometheus server is required. See the official
   [prometheus.scrape reference](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.scrape/).
6. Import [usage-dashboard.json](usage-dashboard.json) into Grafana and choose the
   Prometheus datasource connected to your existing metrics destination. Confirm
   backend availability is 1, launch a view, and confirm the lifetime count.

## Metric meanings

All usage series have only the `mode` dimension. `demo` means the bundled contest
1735 replay snapshot; the setup page's miniature simulation is never a demo view.
No handle, credential, contest ID, URL, or arbitrary error text is a metric label.
There are no visitor identifiers, cookies, or browser-persisted event queues.

| Metric | Meaning | Storage |
| --- | --- | --- |
| `cf_usage_page_views_total` | Once per completed navigation or refresh; setup/live/replay/demo | SQLite lifetime |
| `cf_usage_completed_setups_total` | Valid setup successfully navigated to live or replay; canceled navigation and direct links add none | SQLite lifetime |
| `cf_usage_displayed_views_total` | Scoreboard first appears for live/replay/demo; rerenders, polling, controls and SSE reconnects add none | SQLite lifetime |
| `cf_usage_countdown_views_total` | Upcoming contest countdown appears; scoreboard appearance later adds a live displayed view | SQLite lifetime |
| `cf_usage_loading_failures_total` | Failed initial loading attempts by live/replay/demo; retries can add failures, background refresh failures do not | In memory |
| `cf_usage_loading_duration_seconds` | Histogram until scoreboard display, excluding time in the countdown; only successful displays contribute | In memory |
| `cf_backend_requests_total` | Completed requests by bounded route/method/status, including errors; SSE counted on close | In memory |
| `cf_backend_request_duration_seconds` | Request latency by bounded route/method, excluding SSE streams | In memory |
| `cf_backend_sse_connections` | Currently connected SSE clients | In memory |
| `cf_codeforces_request_duration_seconds` | Backend Codeforces HTTP call histogram by bounded `method` and `outcome`; includes download/decoding, excludes local pacing | In memory |
| `cf_codeforces_rate_limit_wait_duration_seconds` | Local pacing/mutex wait before started backend calls, by `method` | In memory |
| `cf_codeforces_submission_responses_total` | Successful backend `contest.status` responses by `history`: `consistent` or `missing_known`, compared with locally retained IDs | In memory |
| `cf_codeforces_submission_omissions_total` | Number of known IDs absent from successful responses; repeated omissions count again | In memory |
| `up{job="cf-live-standings"}` | Alloy can scrape the backend metrics listener | Alloy |

Known usage counters start at zero. Database read errors and the 2-second collection deadline fail the scrape rather
than exporting false zero totals. Back up `live.sqlite` with its WAL consistently
using SQLite backup tooling; lifetime totals are only as durable as this database.
Use a single backend process per database. Restarts preserve lifetime totals;
histograms and operational/failure counters reset.

Lifetime totals represent received, committed events, beginning at rollout;
browser delivery is best effort and historical usage cannot be reconstructed.
Selected-period panels use reset-aware `increase()` and are extrapolated
estimates, particularly across scrape gaps, restarts, or short windows. See the
[Prometheus increase documentation](https://prometheus.io/docs/prometheus/latest/querying/functions/#increase).
Availability measures the scrape listener, not end-to-end Codeforces reliability.
Visitor tracking, funnels, infrastructure monitoring, and alerts are deferred.

## Codeforces API latency

The backend records calls to `contest.status` and `contest.standings` from HTTP
dispatch through response download, decoding, and body close. Local pacing and
mutex wait are recorded separately, so the intentional 2.1-second request spacing
does not inflate upstream latency. Calls canceled while still waiting locally,
and invalid requests that never reach dispatch, do not contribute to either
histogram. These metrics cover the Go live backend, not the Next.js proxy or
browser-direct Codeforces calls.

The `outcome` values are `success`, `http_error`, `api_error`, `decode_error`,
`transport_error`, `timeout`, and `canceled`. HTTP/API rejection, malformed
responses, network failures and client deadlines all contribute observations.
Only bounded method/outcome names become labels; request URLs, contest IDs,
handles, and error text never do. Operational histograms reset on backend restart.

Grafana provides p50/p95/p99 call latency by API method across all outcomes,
call rate by method/outcome, and p95 local rate-limit wait. Quantiles require
multiple scrapes; a seeded histogram with no requests may return NaN. The HTTP
client timeout is currently 30 seconds, and buckets cover that range.

## Missing upstream submission history

The live backend compares each successful `contest.status` response by submission
ID with its retained history **before merging**. If a known ID disappears, it
increments the `missing_known` response counter and adds the missing ID count to
`cf_codeforces_submission_omissions_total`. A response can have more submissions
than the previous response and still be missing older IDs. An empty successful
response omits all retained IDs; HTTP/API failures are excluded. Observations
still count if a later database write or standings request fails.

Grafana includes affected responses, omission counts, and the percentage of
successful responses with missing known history. Selected-period counters use
`increase()` estimates; operational counters reset on backend restart. For
example, one ID absent from three responses counts as three affected responses
and three omissions, rather than three distinct missing submissions.

A warning `Codeforces submission history incomplete` records the contest ID and
missing/returned/retained counts when an episode starts. An info log
`Codeforces submission history recovered` records the next response containing
all retained IDs. Repeated partial responses update metrics without repeating
warnings. No handles or submission IDs are logged, and neither contest IDs nor
participant identifiers are metric labels.

This detects missing **previously observed** submissions, including IDs restored
from SQLite. `consistent` means only that no known IDs are missing; it does not
prove the response contains all submissions ever made. Submissions never
observed cannot be detected or recovered by this comparison. The existing merge
continues to retain missing submissions and apply verdict changes to returned
IDs. This monitoring runs in the Go live backend, independently of browser
telemetry; browser-only polling does not contribute.

## Verification

Run backend `go test -race ./...` and frontend `pnpm test`, `pnpm lint`, and
`pnpm build`. Browser tests mock requests to `/api/telemetry`.

For an isolated Docker integration check:

```sh
docker build -t cf-usage-metrics-check ./backend
python3 monitoring/smoke.py
```

The check creates a temporary Docker network, backend, Alloy, and a test-only
Prometheus remote-write receiver. It validates the Alloy config, exercises a real
scrape and remote write, evaluates every dashboard query, checks deduplication
and totals across a backend restart, and removes its containers/network/volume.
It does not touch the existing monitoring stack or require production credentials.
