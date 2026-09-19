import assert from 'node:assert/strict';
import test from 'node:test';
import type { Contest } from '../../../shared/domain/contest.ts';
import { findUpcomingContests } from './upcomingContests.ts';

const contest = (overrides: Partial<Contest>): Contest => ({
  id: 1,
  name: 'Contest',
  type: 'CF',
  phase: 'BEFORE',
  frozen: false,
  durationSeconds: 7_200,
  startTimeSeconds: 2_000,
  relativeTimeSeconds: -1_000,
  preparedBy: '',
  websiteUrl: '',
  description: '',
  difficulty: 0,
  kind: '',
  icpcRegion: '',
  country: '',
  city: '',
  season: '',
  ...overrides,
});

test('prioritizes live contests before future contests within the three slots', () => {
  const result = findUpcomingContests([
    contest({ id: 5, startTimeSeconds: 6_000 }),
    contest({ id: 2, startTimeSeconds: 3_000 }),
    contest({ id: 4, startTimeSeconds: 5_000 }),
    contest({ id: 3, startTimeSeconds: 4_000 }),
    contest({ id: 6, phase: 'CODING', startTimeSeconds: 500 }),
  ], 1_000);

  assert.deepEqual(result.map(({ id }) => id), [6, 2, 3]);
});

test('ignores stale before contests and contests that are no longer running', () => {
  const result = findUpcomingContests([
    contest({ id: 1, startTimeSeconds: 1_000 }),
    contest({ id: 2, phase: 'FINISHED', startTimeSeconds: 500 }),
    contest({ id: 3, phase: 'SYSTEM_TEST', startTimeSeconds: 500 }),
  ], 1_000);

  assert.deepEqual(result, []);
});
