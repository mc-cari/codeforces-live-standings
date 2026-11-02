import assert from 'node:assert/strict';
import test from 'node:test';
import type { Party, Standings, Submission } from '../../../shared/domain/contest.ts';
import { projectLiveUpdate } from './projectLiveUpdate.ts';
import { mapStandingsDto, mapSubmissionDto } from '../../../integrations/codeforces/mapper.ts';

const party = (handle: string): Party => ({
  contestId: 1,
  members: [{ handle, name: handle }],
  participantType: 'CONTESTANT',
  teamId: undefined,
  teamName: undefined,
  ghost: false,
  room: undefined,
  startTimeSeconds: 0,
  rank: 0,
});

const standings: Standings = {
  contest: {
    id: 1,
    name: 'Round',
    type: 'CF',
    phase: 'CODING',
    frozen: false,
    durationSeconds: 7_200,
    startTimeSeconds: 0,
    relativeTimeSeconds: 0,
    preparedBy: '', websiteUrl: '', description: '', difficulty: 0,
    kind: '', icpcRegion: '', country: '', city: '', season: '',
  },
  problems: [{ index: 'A', points: 500 } as never],
  rows: [{
    party: party('Tourist'),
    rank: 1,
    points: 500,
    penalty: 0,
    successfulHackCount: 0,
    unsuccessfulHackCount: 0,
    problemResults: [{
      points: 500,
      penalty: 0,
      rejectedAttemptCount: 0,
      type: 'FINAL',
      bestSubmissionTimeSeconds: 100,
    }],
    lastSubmissionTimeSeconds: 100,
  }],
};

const submission = (id: number): Submission => ({
  id,
  contestId: 1,
  creationTimeSeconds: id,
  relativeTimeSeconds: id,
  problem: standings.problems[0],
  author: party('Tourist'),
  programmingLanguage: 'GNU C++17',
  verdict: 'OK',
  testset: 'TESTS',
  passedTestCount: 1,
  timeConsumedMillis: 1,
  memoryConsumedBytes: 1,
  points: 500,
  numberOfProblems: 0,
});

test('projects live updates without mutating prior submissions', () => {
  const previous = [submission(1)];
  const previousCopy = structuredClone(previous);
  const projection = projectLiveUpdate(standings, [submission(1), submission(2)], previous, ['tourist']);

  assert.deepEqual(previous, previousCopy);
  assert.deepEqual(projection.submissions.map(({ id }) => id), [2, 1]);
  assert.equal(projection.submissions[0].author.rank, 1);
  assert.equal(projection.submissions[0].numberOfProblems, 1);
  assert.equal(projection.newSubmissionCount, 1);
});


test('SSE projections preserve source order, ties, deletions and decorated submissions', () => {
  const source = structuredClone(standings);
  source.rows = [
    { ...source.rows[0], party: party('b'), rank: 2, points: 400 },
    { ...source.rows[0], party: party('a'), rank: 3, points: 400 },
    { ...source.rows[0], party: party('c'), rank: 3, points: 400 },
  ];
  const retained = { ...submission(2), author: { ...party('b'), rank: 1 }, numberOfProblems: 7 };
  const projection = projectLiveUpdate(source, [retained], [submission(1)], ['a', 'b', 'c', 'Tourist'], true);
  assert.deepEqual(projection.standings.rows.map((row) => row.party.members[0].handle), ['b', 'a', 'c']);
  assert.equal(projection.localStandings.get('b'), 1);
  assert.equal(projection.localStandings.get('a'), 2);
  assert.equal(projection.localStandings.get('c'), 2);
  assert.deepEqual(projection.submissions.map(({ id }) => id), [2]);
  assert.equal(projection.submissions[0].numberOfProblems, 7);
  assert.equal(projection.standings.rows.length, 3);
});


test('SSE DTO mapping retains the Go participant position and solved count', () => {
  const mapped = mapSubmissionDto({ ...submission(1), author: { ...party('Tourist'), rank: 2 }, numberOfProblems: 7 });
  const source = structuredClone(standings);
  source.rows[0].party.rank = 2;
  assert.equal(mapStandingsDto(source).rows[0].party.rank, 2);
  assert.equal(mapped.author.rank, 2);
  assert.equal(mapped.numberOfProblems, 7);
});
