import assert from 'node:assert/strict';
import test from 'node:test';
import calculateReplayPenalty, { countRejectedAttempt } from './replayScoring.ts';

test('does not count more rejected events than the final standings row', () => {
  assert.equal(countRejectedAttempt(0, 1), 1);
  assert.equal(countRejectedAttempt(1, 1), 1);
  assert.equal(countRejectedAttempt(0, 0), 0);
  assert.equal(countRejectedAttempt(1), 2);
});

test('educational replay reconstructs ICPC penalty', () => {
  const penalty = calculateReplayPenalty('ICPC', [
    { points: 1, rejectedAttemptCount: 0, bestSubmissionTimeSeconds: 121 },
    { points: 1, rejectedAttemptCount: 1, bestSubmissionTimeSeconds: 549 },
    { points: 0, rejectedAttemptCount: 3, bestSubmissionTimeSeconds: 0 },
  ]);

  assert.equal(penalty, 31);
  assert.ok(Number.isFinite(penalty));
});

test('normal replay does not apply ICPC penalty', () => {
  const penalty = calculateReplayPenalty('CF', [
    { points: 500, rejectedAttemptCount: 2, bestSubmissionTimeSeconds: 600 },
  ]);

  assert.equal(penalty, 0);
});
