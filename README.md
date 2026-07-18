
## Codeforces Live Standings

Website for a dynamic visualization for live standings of [Codeforces](https://codeforces.com) competitions for a custom selection of users, the subissions and standings are updated automatically. The style of the website is the one used for ICPC competitions ([ICPC World Finals Dhaka Standings](https://www.youtube.com/live/15Wyj_-PG9I?feature=share&t=10935)) because it has an interesting design.

[Contest 1797](https://codeforces-live-standings.vercel.app/contests/1797/standings?contestType=normal&handles=Maruzensky&handles=shell_wataru&handles=noahhb&handles=FedeNQ&handles=julianferres&handles=martins&handles=CodigoL&handles=Cegax&handles=MateoCV&handles=Graphter&handles=MrNachoX&handles=mc._cari&handles=Xc4l16r3&handles=gabmei) example.

Website link: [Codeforces Live Standings](https://codeforces-live-standings.vercel.app).

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

### Development

Setup the proyect with:

```sh
corepack enable
pnpm install
```

Init the proycect with:

``sh
pnpm dev
``