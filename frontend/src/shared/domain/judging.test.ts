import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPendingContestJudging } from './judging.ts';

test('pending contest judging includes submitted, testing and absent verdicts within the contest only', () => {
  const submission = (verdict?: string, time = 7200, type = 'CONTESTANT') => ({
    verdict, relativeTimeSeconds: time, author: { participantType: type },
  });
  for (const verdict of [undefined, '', 'TESTING', 'SUBMITTED']) {
    assert.equal(hasPendingContestJudging([submission(verdict)], 7200), true);
  }
  for (const verdict of ['OK', 'CHALLENGED', 'WRONG_ANSWER', 'SKIPPED']) {
    assert.equal(hasPendingContestJudging([submission(verdict)], 7200), false);
  }
  assert.equal(hasPendingContestJudging([submission('TESTING', 7201)], 7200), false);
  assert.equal(hasPendingContestJudging([submission('TESTING', -1)], 7200), false);
  assert.equal(hasPendingContestJudging([submission('TESTING', 100, 'PRACTICE')], 7200), false);
});
