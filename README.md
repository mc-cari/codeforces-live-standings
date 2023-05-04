
## Codeforces Live Standings

Website for a dynamic visualization for live standings of [Codeforces](https://codeforces.com) competitions for a custom selection of users, the subissions and standings are updated automatically. The style of the website is the one used for ICPC competitions ([ICPC World Finals Dhaka Standings](https://www.youtube.com/live/15Wyj_-PG9I?feature=share&t=10935)) because it has an interesting design.

[Contest 1797](https://codeforces-live-standings.vercel.app/contests/1797/standings?contestType=normal&handles=Maruzensky&handles=shell_wataru&handles=noahhb&handles=FedeNQ&handles=julianferres&handles=martins&handles=CodigoL&handles=Cegax&handles=MateoCV&handles=Graphter&handles=MrNachoX&handles=mc._cari&handles=Xc4l16r3&handles=gabmei) example.

Website link: [Codeforces Live Standings](codeforces-live-standings.vercel.app)

It has support for:

  - Normal Rounds
  - Educational Rounds
  - Gym Contests (Teams are recognized by one of its members, due to the Codeforces API design)

The website works with old contests and live contests.

Codeforces blog post: [Codeforces Live Standings](https://codeforces.com/blog/entry/114892)

The wesite uses the [Codeforces API](https://codeforces.com/apiHelp) to get the data. During competitions, the API doesn't provide all the submissions, becuase they are bbeign updated at the same tie, so the API responses are merged with the local status.