import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectVisible, nextPending, hackKey, cellKey } from './projection.ts';
import { hackCoverageIncomplete, hackPoints, mergeHacks, selectsHack, type Hack } from '../domain/hacks.ts';
import type { ReplayStandings, ReplaySubmission } from '../../contexts/replay/domain/models.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/codeforces-566-hacks.json', import.meta.url), 'utf8')) as {
  standings: ReplayStandings; submissions: ReplaySubmission[]; hacks: Hack[];
};
const party = (handle: string) => ({ members: [{ handle }], participantType: 'CONTESTANT' });
const hack = (id = 1, time = 3600, verdict = 'HACK_SUCCESSFUL'): Hack => ({ id,
  creationTimeSeconds: time, hacker: party('alpha'), defender: party('beta'), problem: { index: 'A' }, verdict });
const board = (type = 'CF') => ({
  contest: { id: 1, type, phase: 'FINISHED', durationSeconds: 7200, startTimeSeconds: 0 },
  problems: [{ index: 'A', points: 500 }],
  rows: ['alpha', 'beta'].map((name) => ({ party: party(name), points: 0, penalty: 0,
    successfulHackCount: 0, unsuccessfulHackCount: 0, rank: 1,
    problemResults: [{ points: 0, penalty: 0, rejectedAttemptCount: 0, bestSubmissionTimeSeconds: 0, type: 'FINAL' }],
  })),
} as ReplayStandings);
const score = (snapshot: ReturnType<typeof projectVisible>, name = 'alpha') =>
  snapshot.standings.rows.find((row) => row.party.members[0].handle === name)!.points;

test('CF successful, unsuccessful and neutral hacks; ICPC ignores adjustments and negative totals survive', () => {
  for (const [verdict, points] of [['HACK_SUCCESSFUL', 100], ['HACK_UNSUCCESSFUL', -50], ['INVALID_INPUT', 0], ['TESTING', 0]] as const) {
    assert.equal(hackPoints('CF', verdict), points);
    assert.equal(score(projectVisible(board(), [], 7200, undefined, undefined, false, false, [hack(1, 100, verdict)])), points);
    assert.equal(score(projectVisible(board('ICPC'), [], 7200, undefined, undefined, false, false, [hack(1, 100, verdict)])), 0);
  }
});

test('merge uses latest verdict per ID, preserves omissions, and discards test/protocol payloads', () => {
  const initial = mergeHacks([], [hack(1), hack(1)]);
  assert.equal(initial.length, 1);
  const updated = mergeHacks(initial, [{ ...hack(1, 100, 'HACK_UNSUCCESSFUL'), test: 'secret', judgeProtocol: {} } as Hack]);
  assert.equal(score(projectVisible(board(), [], 7200, undefined, undefined, false, false, updated)), -50);
  assert.deepEqual(mergeHacks(updated, []), updated);
  assert.equal('test' in updated[0], false);
  assert.equal('judgeProtocol' in updated[0], false);
});

test('team/member identities select either side case insensitively, score only the hacker once', () => {
  const event = { ...hack(), hacker: { ...party('MEMBER'), teamName: 'Team One' } };
  assert.ok(selectsHack(event, ['member']));
  assert.ok(selectsHack(event, ['team one']));
  assert.ok(selectsHack(event, ['BETA']));
  assert.ok(!selectsHack(event, ['nobody']));
  const standings = board(); standings.rows[0].party = { ...party('member'), teamName: 'Team One' };
  const snapshot = projectVisible(standings, [], 7200, undefined, undefined, false, false, [event, event]);
  assert.equal(snapshot.standings.rows.find((row) => row.party.teamName)?.points, 100);
  assert.equal(score(snapshot, 'beta'), 0);
});

test('inclusive cutoff hides rows and all rank/score effects; hack reveal is globally atomic', () => {
  const events = [hack(1, 3599, 'INVALID_INPUT'), hack(2, 3600), hack(3, 3601, 'HACK_UNSUCCESSFUL')];
  const first = projectVisible(board(), [], 7200, 3600, undefined, false, false, events);
  assert.deepEqual(first.hacks.map((event) => event.id), [1]);
  assert.equal(score(first), 0);
  assert.equal(nextPending(first)?.key, hackKey(2));
  const revealed = new Set([hackKey(2)]);
  const next = projectVisible(board(), [], 7200, 3600, revealed, false, false, events);
  assert.equal(score(next), 100);
  assert.deepEqual(next.hacks.map((event) => event.id), [1, 2]);
  assert.equal(next.pendingHacks.length, 1);
  assert.equal(nextPending(next)?.key, hackKey(3));
  revealed.add(hackKey(3));
  const complete = projectVisible(board(), [], 7200, 3600, revealed, false, false, events);
  assert.equal(score(complete), 50);
  assert.equal(nextPending(complete), undefined);
  assert.equal(complete.hacks.length, 3);
});

test('resolver reveals participant problem cells before hacks in creation-time/ID order', () => {
  const submission = { id: 1, author: party('beta'), problem: { index: 'A' }, relativeTimeSeconds: 3600, verdict: 'OK' } as ReplaySubmission;
  const events = [hack(3, 4000), hack(2, 3600), hack(1, 3600)];
  const initial = projectVisible(board(), [submission], 7200, 3600, undefined, false, false, events);
  assert.equal(nextPending(initial)?.key, cellKey('beta', 'A'));
  const next = projectVisible(board(), [submission], 7200, 3600, new Set([cellKey('beta', 'A')]), false, false, events);
  assert.equal(nextPending(next)?.key, hackKey(1));
});

test('post-contest hacks appear at terminal replay position and remain hidden under freeze', () => {
  const events = [hack(1, 7300)];
  assert.equal(projectVisible(board(), [], 7199, undefined, undefined, false, false, events).hacks.length, 0);
  assert.equal(projectVisible(board(), [], 7200, undefined, undefined, false, false, events).hacks.length, 1);
  assert.equal(projectVisible(board(), [], 7200, 3600, undefined, false, false, events).hacks.length, 0);
});

test('observed official freeze baseline preserves unavailable hack points until authoritative reconciliation', () => {
  const baseline = board(); baseline.rows[0].points = 100;
  const latest = board(); latest.rows[0].points = 150;
  const events = [hack(1, 100), hack(2, 4000, 'HACK_UNSUCCESSFUL')];
  const frozen = projectVisible(latest, [], 7200, 3600, undefined, false, false, [], baseline);
  assert.equal(score(frozen), 100);
  assert.equal(frozen.hacks.length, 0);
  const after = projectVisible(latest, [], 7200, 3600, new Set([hackKey(2)]), false, false, events, baseline);
  assert.equal(score(after), 50); // pre-cutoff +100 was already in the baseline
  assert.equal(score(projectVisible(latest, [], 7200, undefined, undefined, true, false, events)), 150);
});

test('coverage remains uncertain live, on failure and on mismatched authoritative hack counts', () => {
  const standings = board(); standings.rows[0].successfulHackCount = 1;
  assert.equal(hackCoverageIncomplete(standings, [], true), true);
  assert.equal(hackCoverageIncomplete(standings, [hack()], false), true);
  assert.equal(hackCoverageIncomplete(standings, [hack()], true), false);
  standings.contest.phase = 'CODING';
  assert.equal(hackCoverageIncomplete(standings, [hack()], true), true);
});

test('real contest 566 reconstruction matches official totals and latest CHALLENGED verdicts at every replay position', () => {
  const { standings, submissions, hacks } = fixture;
  assert.equal(hacks.length, 18);
  assert.equal(hackCoverageIncomplete(standings, hacks, true), false);
  const result = projectVisible(standings, submissions, standings.contest.durationSeconds, undefined, undefined, false, false, hacks);
  for (const official of standings.rows) {
    const row = result.standings.rows.find((row) => row.party.members[0].handle === official.party.members[0].handle)!;
    assert.equal(row.points, official.points);
    assert.equal(row.successfulHackCount, official.successfulHackCount);
    assert.equal(row.unsuccessfulHackCount, official.unsuccessfulHackCount);
  }
  const challenged = submissions.filter((event) => event.verdict === 'CHALLENGED');
  assert.equal(challenged.length, 3);
  for (const time of [2000, 4000, 8000, 10800, 1000, 10800]) {
    const snapshot = projectVisible(standings, submissions, time, undefined, undefined, false, false, hacks);
    for (const event of challenged.filter((event) => event.relativeTimeSeconds <= time)) {
      assert.equal(snapshot.submissions.find((row) => row.id === event.id)?.verdict, 'CHALLENGED');
    }
  }
  for (const hack of hacks.filter((event) => event.hacker.members[0].handle === 'Misha100896')) {
    const time = hack.creationTimeSeconds - standings.contest.startTimeSeconds;
    const before = projectVisible(standings, submissions, time - 1, undefined, undefined, false, false, hacks);
    const after = projectVisible(standings, submissions, time, undefined, undefined, false, false, hacks);
    assert.equal(score(after, 'Misha100896') - score(before, 'Misha100896'), hackPoints('CF', hack.verdict));
  }
});
