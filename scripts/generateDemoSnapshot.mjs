import { mkdir, writeFile } from 'node:fs/promises';
import { addMissingParticipantRows } from '../utils/participantStandings.ts';

const contestId = 1735;
const handles = [
  'MateoCV', 'mc._cari', 'dmga44', 'Marckess', 'julianferres', 'pacha2880', 'Giga_Cronos',
  'martins', 'martinius', 'Mateo', 'MesSimonFallon19', 'Scano', 'Agaric',
  'estoy-re-sebado', 'Tainel', 'Marceantasy', 'AngrySeal',
];
const selectedHandles = new Set(handles);
const rejectedAttemptOverrides = new Map([
  ['dmga44:E', 6],
  ['martinius:E', 0],
]);
const apiUrl = 'https://codeforces.com/api/';

const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });
const request = async (method, parameters) => {
  const query = new URLSearchParams(parameters);
  const url = `${apiUrl}${method}?${query.toString().replaceAll('%3B', ';')}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      const payload = JSON.parse(body);
      if (!response.ok || payload.status !== 'OK') {
        throw new Error(payload.comment || `Codeforces ${method} request failed`);
      }
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(2_100);
    }
  }

  throw lastError;
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
  && submission.relativeTimeSeconds >= 0
  && submission.relativeTimeSeconds <= standings.contest.durationSeconds
));
const userRanks = Object.fromEntries(users.flatMap((user) => [
  [user.handle, user.rank],
  [`${user.handle} (practice)`, user.rank],
]));
const selectedStandings = {
  ...standings,
  rows: standings.rows.filter((row) => belongsToDemo(row.party)),
};
const getParticipantName = (party) => (
  party.members[0].handle + (party.participantType === 'PRACTICE' ? ' (practice)' : '')
);
const demoStandings = addMissingParticipantRows(
  selectedStandings,
  submissions,
  getParticipantName,
);
rejectedAttemptOverrides.forEach((rejectedAttemptCount, participantProblem) => {
  const [participantName, problemIndex] = participantProblem.split(':');
  const row = demoStandings.rows.find((candidate) => getParticipantName(candidate.party) === participantName);
  const problemPosition = demoStandings.problems.findIndex((problem) => problem.index === problemIndex);
  if (!row || problemPosition < 0) {
    throw new Error(`Unable to apply final standings override for ${participantProblem}`);
  }
  row.problemResults[problemPosition].rejectedAttemptCount = rejectedAttemptCount;
});
const includedHandles = new Set([
  ...demoStandings.rows.flatMap((row) => row.party.members.map((member) => member.handle)),
  ...submissions.flatMap((submission) => (
    submission.author.members.map((member) => member.handle)
  )),
]);
const missingHandles = handles.filter((handle) => !includedHandles.has(handle));
if (missingHandles.length > 0) {
  throw new Error(`Demo participants missing from contest data: ${missingHandles.join(', ')}`);
}
const snapshot = {
  standings: demoStandings,
  submissions,
  userRanks,
};

await mkdir(new URL('../public/demo/', import.meta.url), { recursive: true });
await writeFile(
  new URL(`../public/demo/${contestId}-v1.json`, import.meta.url),
  JSON.stringify(snapshot),
);
console.log(`Wrote demo snapshot with ${snapshot.standings.rows.length} rows and ${submissions.length} submissions.`);
