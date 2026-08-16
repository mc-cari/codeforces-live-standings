
## Codeforces Live Standings

Website for a dynamic visualization for live standings of [Codeforces](https://codeforces.com) competitions for a custom selection of users, the submissions and standings are updated automatically. The style of the website is the one used for ICPC competitions ([ICPC World Finals Dhaka Standings](https://www.youtube.com/live/15Wyj_-PG9I?feature=share&t=10935)) because it has an interesting design.

[Contest 1735 replay demo](https://codeforces-live-standings.mccari.us/contests/1735/replay?contestType=normal&startTime=2%3A50&playbackSpeed=15&autoplay=true&demo=true&h=TWF0ZW9DVjttYy5fY2FyaTtkbWdhNDQ7TWFyY2tlc3M7anVsaWFuZmVycmVzO3BhY2hhMjg4MDtHaWdhX0Nyb25vczttYXJ0aW5zO21hcnRpbml1cztNYXRlbztNZXNTaW1vbkZhbGxvbjE5O1NjYW5vO0FnYXJpYztlc3RveS1yZS1zZWJhZG87VGFpbmVsO01hcmNlYW50YXN5O0FuZ3J5U2VhbA).

Website link: [Codeforces Live Standings](https://codeforces-live-standings.mccari.us/).

It has support for:

  - Normal Rounds
  - Educational Rounds
  - Gym Contests (Teams are recognized by one of its members, due to the Codeforces API design)

The website works with old contests and live contests and also shows the practice submissions.

[Codeforces blog post](https://codeforces.com/blog/entry/114892).

The wesite uses the [Codeforces API](https://codeforces.com/apiHelp) to get the data. During competitions, the API doesn't provide all the submissions, becuase they are beign updated at the same time, so the API responses are merged with the local status.

### Codeforces API credentials

Create `.env` from `.env.example` and set `CF_API_KEY` and `CF_API_SECRET` to a
Codeforces API key pair.

You can get an API key from https://codeforces.com/settings/api.

During contest setup, the app can import the friends for an authorized Codeforces
account through `user.friends`. The account handle is required as a confirmation;
Codeforces does not provide an anonymous or arbitrary-handle friends endpoint.
Deployments can use the configured `CF_API_KEY`/`CF_API_SECRET`, or a user can
provide a key pair for the one-time import request. User-provided credentials are
sent in a POST body and are not stored by the app.

### Development

Set up the project with:

```sh
corepack enable
pnpm install
```

Start the development server with:

```sh
pnpm dev
```

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
`public/demo/1735-v1.json` snapshot and makes no Codeforces API requests. 
Run:

```sh
pnpm generate-demo
```
