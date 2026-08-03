import assert from 'node:assert/strict';
import test from 'node:test';
import { addMissingParticipantRows } from './participantStandings.ts';

const party = (handle: string, participantType: string) => ({
  members: [{ handle, name: handle }],
  participantType,
} as Party);

const submission = (
  id: number,
  handle: string,
  participantType: string,
  verdict: string,
  relativeTimeSeconds: number,
  points = 0,
) => ({
  id,
  author: party(handle, participantType),
  problem: { index: 'A' },
  verdict,
  relativeTimeSeconds,
  points,
} as Submission);

const standings = (type: string) => ({
  contest: { durationSeconds: 7200, type },
  problems: [{ index: 'A', points: 500 }],
  rows: [],
} as Standings);

const getHandle = (participant: Party) => participant.members[0].handle;

test('adds a virtual ICPC participant from submissions', () => {
  const result = addMissingParticipantRows(standings('ICPC'), [
    submission(1, 'virtual-user', 'VIRTUAL', 'WRONG_ANSWER', 60),
    submission(2, 'virtual-user', 'VIRTUAL', 'OK', 180),
  ], getHandle);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].party.participantType, 'VIRTUAL');
  assert.equal(result.rows[0].points, 1);
  assert.equal(result.rows[0].penalty, 23);
});

test('reconstructs CF points when accepted submissions omit points', () => {
  const result = addMissingParticipantRows(standings('CF'), [
    submission(1, 'unofficial-user', 'OUT_OF_COMPETITION', 'WRONG_ANSWER', 60),
    submission(2, 'unofficial-user', 'OUT_OF_COMPETITION', 'OK', 300),
  ], getHandle);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].points, 440);
});

test('uses Codeforces scoring without scaling penalties by contest duration', () => {
  const contestStandings = standings('CF');
  contestStandings.contest.durationSeconds = 8_100;
  contestStandings.problems = [500, 750, 1_250, 1_750, 2_250]
    .map((points, index) => ({ index: 'ABCDE'[index], points } as Problem));
  const contestSubmission = (
    id: number,
    problemIndex: string,
    relativeTimeSeconds: number,
  ) => ({
    ...submission(id, 'MateoCV', 'OUT_OF_COMPETITION', 'OK', relativeTimeSeconds),
    problem: contestStandings.problems.find((problem) => problem.index === problemIndex) as Problem,
    points: undefined,
  } as unknown as Submission);

  const result = addMissingParticipantRows(contestStandings, [
    contestSubmission(1, 'A', 144),
    contestSubmission(2, 'B', 1_029),
    contestSubmission(3, 'C', 1_940),
    contestSubmission(4, 'D', 2_697),
    contestSubmission(5, 'E', 6_707),
  ], getHandle);

  assert.deepEqual(
    result.rows[0].problemResults.map((problem) => problem.points),
    [496, 699, 1_090, 1_442, 1_251],
  );
  assert.equal(result.rows[0].points, 4_978);
});

test('reconstructs all jiangly solves from contest 1797 submissions', () => {
  const contestStandings = standings('CF');
  contestStandings.problems = [500, 1000, 1500, 1750, 2250, 3000]
    .map((points, index) => ({ index: 'ABCDEF'[index], points } as Problem));
  const contestSubmission = (
    id: number,
    problemIndex: string,
    verdict: string,
    relativeTimeSeconds: number,
  ) => ({
    ...submission(id, 'jiangly', 'OUT_OF_COMPETITION', verdict, relativeTimeSeconds),
    problem: contestStandings.problems.find((problem) => problem.index === problemIndex) as Problem,
    points: undefined,
  } as unknown as Submission);

  const result = addMissingParticipantRows(contestStandings, [
    contestSubmission(1, 'A', 'OK', 133),
    contestSubmission(2, 'B', 'OK', 248),
    contestSubmission(3, 'C', 'WRONG_ANSWER', 452),
    contestSubmission(4, 'C', 'WRONG_ANSWER', 531),
    contestSubmission(5, 'C', 'OK', 597),
    contestSubmission(6, 'D', 'OK', 988),
    contestSubmission(7, 'E', 'TIME_LIMIT_EXCEEDED', 1550),
    contestSubmission(8, 'E', 'WRONG_ANSWER', 1999),
    contestSubmission(9, 'E', 'OK', 2256),
    contestSubmission(10, 'F', 'OK', 2953),
  ], getHandle);

  assert.equal(result.rows[0].problemResults.filter((problem) => problem.points > 0).length, 6);
  assert.equal(result.rows[0].points, 8693);
});

test('does not duplicate a participant already present in official standings', () => {
  const officialStandings = standings('ICPC');
  officialStandings.rows.push({ party: party('official-user', 'CONTESTANT') } as RanklistRow);

  const result = addMissingParticipantRows(officialStandings, [
    submission(1, 'official-user', 'CONTESTANT', 'OK', 180),
  ], getHandle);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0], officialStandings.rows[0]);
});
