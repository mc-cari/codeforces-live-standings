import assert from 'node:assert/strict';
import test from 'node:test';
import { formatElapsedTime, getPlaybackSpeed, getStartTime } from './replayConfiguration.ts';

test('normalizes replay configuration from route values', () => {
  assert.equal(formatElapsedTime(3_661), '01:01:01');
  assert.equal(getPlaybackSpeed('15'), 15);
  assert.equal(getPlaybackSpeed('10000'), 1);
  assert.equal(getStartTime('2:30', 7_200, 0), 150);
  assert.equal(getStartTime('999', 7_200, 0), 7_200);
  assert.equal(getStartTime('-1', 7_200, 60), 60);
});
