import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CodeforcesPartyDto,
  CodeforcesStandingsDto,
  CodeforcesSubmissionDto,
} from '../../../integrations/codeforces/contracts.ts';
import { projectLiveUpdate } from './projectLiveUpdate.ts';

const party = (handle: string): CodeforcesPartyDto => ({
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

const standings: CodeforcesStandingsDto = {
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

const submission = (id: number): CodeforcesSubmissionDto => ({
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
