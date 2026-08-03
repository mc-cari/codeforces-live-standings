import { mkdir, writeFile } from 'node:fs/promises';

const contestId = 1797;
const handles = [
  'Maruzensky', 'shell_wataru', 'noahhb', 'FedeNQ', 'julianferres', 'martins', 'CodigoL',
  'Cegax', 'MateoCV', 'Graphter', 'MrNachoX', 'mc._cari', 'Xc4l16r3', 'gabmei',
];
const selectedHandles = new Set(handles);
const apiUrl = 'https://codeforces.com/api/';

const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
const request = async (method, parameters) => {
  const query = new URLSearchParams(parameters);
  const response = await fetch(`${apiUrl}${method}?${query.toString().replaceAll('%3B', ';')}`);
  const payload = await response.json();
  if (!response.ok || payload.status !== 'OK') {
    throw new Error(payload.comment || `Codeforces ${method} request failed`);
  }
  return payload.result;
};
const belongsToDemo = (party) => party.members
  .some((member) => selectedHandles.has(member.handle));

const standings = await request('contest.standings', { contestId: String(contestId) });
await wait(2_100);
const allSubmissions = await request('contest.status', { contestId: String(contestId) });
await wait(2_100);
const users = await request('user.info', { handles: handles.join(';') });

const submissions = allSubmissions.filter((submission) => (
  belongsToDemo(submission.author)
  && submission.author.participantType === 'CONTESTANT'
  && submission.relativeTimeSeconds >= 0
  && submission.relativeTimeSeconds <= standings.contest.durationSeconds
));
const userRanks = Object.fromEntries(users.flatMap((user) => [
  [user.handle, user.rank],
  [`${user.handle} (practice)`, user.rank],
]));
const snapshot = {
  standings: { ...standings, rows: standings.rows.filter((row) => belongsToDemo(row.party)) },
  submissions,
  userRanks,
};

await mkdir(new URL('../public/demo/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../public/demo/1797-v1.json', import.meta.url),
  JSON.stringify(snapshot),
);
console.log(`Wrote demo snapshot with ${snapshot.standings.rows.length} rows and ${submissions.length} submissions.`);
