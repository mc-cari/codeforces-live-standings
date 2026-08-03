import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCountdown, getContestConfiguration, secondsUntilContest } from './contestConfiguration.ts';

const contest = (overrides: Partial<Contest>): Contest => ({
  id: 2246,
  name: 'Codeforces Round 1108',
  type: 'CF',
  phase: 'FINISHED',
  frozen: false,
  durationSeconds: 7_200,
  startTimeSeconds: 2_000,
  relativeTimeSeconds: 0,
  preparedBy: '', websiteUrl: '', description: '', difficulty: 0,
  kind: '', icpcRegion: '', country: '', city: '', season: '',
  ...overrides,
});

test('maps contest 2242-style ICPC scoring to educational replay', () => {
  assert.deepEqual(getContestConfiguration(contest({ id: 2242, type: 'ICPC' })), {
    contestType: 'educational', route: 'replay', actionLabel: 'Start Replay',
  });
});

test('maps contest 2246-style CF scoring to normal replay', () => {
  assert.deepEqual(getContestConfiguration(contest({ id: 2246, type: 'CF' })), {
    contestType: 'normal', route: 'replay', actionLabel: 'Start Replay',
  });
});

test('keeps before and coding contests on the live route', () => {
  assert.equal(getContestConfiguration(contest({ phase: 'BEFORE' })).actionLabel, 'Open Countdown');
  assert.equal(getContestConfiguration(contest({ phase: 'CODING' })).actionLabel, 'Start Live Tracking');
  assert.equal(getContestConfiguration(contest({ phase: 'CODING' })).route, 'standings');
});

test('rejects IOI scoring clearly', () => {
  assert.equal(getContestConfiguration(contest({ type: 'IOI' })).unsupportedReason,
    'IOI scoring is not supported yet.');
});

test('formats and clamps countdowns', () => {
  assert.equal(secondsUntilContest(contest({ startTimeSeconds: 2_000 }), 1_500_000), 500);
  assert.equal(secondsUntilContest(contest({ startTimeSeconds: 1_000 }), 1_500_000), 0);
  assert.equal(formatCountdown(90_061), '1d 01:01:01');
  assert.equal(formatCountdown(-2), '00:00:00');
});
