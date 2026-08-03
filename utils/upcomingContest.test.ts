import assert from 'node:assert/strict';
import test from 'node:test';
import { findUpcomingContests } from './upcomingContest.ts';

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

test('returns up to three future contests in chronological order', () => {
  const result = findUpcomingContests([
    contest({ id: 5, startTimeSeconds: 6_000 }),
    contest({ id: 2, startTimeSeconds: 3_000 }),
    contest({ id: 4, startTimeSeconds: 5_000 }),
    contest({ id: 3, startTimeSeconds: 4_000 }),
  ], 1_000);

  assert.deepEqual(result.map(({ id }) => id), [2, 3, 4]);
});

test('ignores contests that started or are not in the before phase', () => {
  const result = findUpcomingContests([
    contest({ id: 1, startTimeSeconds: 1_000 }),
    contest({ id: 2, phase: 'CODING', startTimeSeconds: 3_000 }),
  ], 1_000);

  assert.deepEqual(result, []);
});
