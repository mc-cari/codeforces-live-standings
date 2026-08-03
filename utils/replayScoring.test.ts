import assert from 'node:assert/strict';
import test from 'node:test';
import calculateReplayPenalty from './replayScoring.ts';

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
