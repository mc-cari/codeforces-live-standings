import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReplayStandings, ReplaySubmission } from '../../contexts/replay/domain/models.ts';
import { cellKey, nextPending, parseFreeze, projectVisible } from './projection.ts';
import { projectLiveUpdate } from '../../contexts/live-standings/domain/projectLiveUpdate.ts';
import type { Standings, Submission } from '../domain/contest.ts';

const party = (name: string) => ({ members: [{ handle: name }], participantType: 'CONTESTANT' });
const board = (type = 'ICPC') => ({
  contest: { id: 1, type, durationSeconds: 7200 },
  problems: [{ index: 'A', points: 500 }, { index: 'B', points: 1000 }],
  rows: ['alpha', 'beta'].map((name) => ({ party: party(name), rank: 1, points: 9999, penalty: 999,
    problemResults: [0, 1].map(() => ({ points: 999, rejectedAttemptCount: 99, bestSubmissionTimeSeconds: 7000 })),
  })),
} as ReplayStandings);
const event = (id: number, name: string, time: number, verdict = 'OK', problem = 'A') => ({
  id, author: party(name), problem: { index: problem }, relativeTimeSeconds: time, verdict,
} as ReplaySubmission);

test('freeze settings validate whole minutes, duration, arrays and manual view edits', () => {
  assert.equal(parseFreeze('60', undefined, 7200).cutoff, 3600);
  assert.equal(parseFreeze(undefined, undefined, 7200).warning, '');
  for (const input of ['0', '-1', '1.5', '120', '', 'NaN', 'Infinity', ['60']]) {
    assert.ok(parseFreeze(input, undefined, 7200).warning);
    assert.equal(parseFreeze(input, undefined, 7200).cutoff, undefined);
  }
  assert.ok(parseFreeze('60', 'bad', 7200).warning);
  assert.ok(parseFreeze(undefined, 'unfrozen', 7200).warning);
  assert.equal(parseFreeze('60', 'unfrozen', 7200).unfrozen, true);
});

test('cutoff is inclusive, counts pending without exposing verdicts or rank effects', () => {
  const result = projectVisible(board(), [event(1, 'alpha', 3599), event(2, 'beta', 3600),
    event(3, 'beta', 3601, 'WRONG_ANSWER')], 7200, 3600);
  assert.equal(result.standings.rows[0].points, 1);
  assert.equal(result.standings.rows[1].points, 0);
  assert.equal(result.pending.get(cellKey('beta', 'A')), 2);
  assert.deepEqual(result.submissions.map((s) => s.id), [1]);
  assert.equal(result.submissions[0].numberOfProblems, 1);
  assert.equal(result.submissions[0].author.rank, 1);
  assert.equal(result.standings.rows[0].problemResults[0].rejectedAttemptCount, 0);
});

test('CF scores and ICPC penalties are calculated only from visible events', () => {
  const events = [event(1, 'alpha', 60, 'COMPILATION_ERROR'), event(2, 'alpha', 120, 'WRONG_ANSWER'),
    event(3, 'alpha', 300), event(4, 'alpha', 4000, 'WRONG_ANSWER')];
  const icpc = projectVisible(board(), events, 7200, 3600);
  assert.equal(icpc.standings.rows[0].penalty, 25);
  const cf = projectVisible(board('CF'), events, 7200, 3600);
  assert.equal(cf.standings.rows[0].points, 440);
  assert.equal(cf.standings.rows[0].problemResults[0].rejectedAttemptCount, 1);
});

test('resolver chooses the lowest current participant and then problem order, reselecting after movement', () => {
  const events = [event(1, 'beta', 3600), event(2, 'beta', 3700, 'OK', 'B'), event(3, 'alpha', 4000)];
  const initial = projectVisible(board(), events, 7200, 3600);
  assert.equal(nextPending(initial)?.key, cellKey('beta', 'A'));
  const first = new Set([cellKey('beta', 'A')]);
  const after = projectVisible(board(), events, 7200, 3600, first);
  assert.equal(nextPending(after)?.key, cellKey('alpha', 'A'));
  const all = new Set(events.map((e) => cellKey(e.author.members[0].handle, e.problem.index)));
  assert.equal(projectVisible(board(), events, 7200, 3600, all).pending.size, 0);
  const final = projectVisible(board(), events, 7200, undefined, all, true);
  assert.equal(final.standings.rows[0].points, 9999);
  assert.equal(final.standings.rows[0].penalty, 999);
  assert.deepEqual(initial.standings.rows.map((r) => r.rank), [1, 1]);
});

test('team identities are consistent between standings, pending cells and the feed', () => {
  const standings = board();
  const team = { ...party('alpha'), teamName: 'Team One', members: [{ handle: 'alpha' }, { handle: 'other' }] };
  standings.rows[0].party = team;
  const events = [{ ...event(1, 'alpha', 3600), author: team }];
  const snapshot = projectVisible(standings, events, 7200, 3600);
  assert.equal(snapshot.pending.get(cellKey('Team One', 'A')), 1);
  const visible = projectVisible(standings, events, 7200, 3600, new Set([cellKey('Team One', 'A')]));
  assert.equal(visible.submissions[0].author.rank, 1);
  assert.equal(visible.submissions[0].numberOfProblems, 1);
});

test('live freeze feed records solved count as of each visible submission', () => {
  const events = [event(1, 'alpha', 100, 'OK'), event(2, 'alpha', 200, 'OK', 'B'),
    event(3, 'alpha', 3600, 'WRONG_ANSWER')];
  const running = projectVisible(board(), events, 7200, 3600, new Set(), false, true);
  assert.equal(running.submissions.find((item) => item.id === 2)?.numberOfProblems, 2);
  assert.equal(running.submissions.find((item) => item.id === 1)?.numberOfProblems, 1);
  const replay = projectVisible(board(), events, 7200, 3600);
  assert.equal(replay.submissions.find((item) => item.id === 1)?.numberOfProblems, 2);
});

test('live history survives partial responses, exceeds rendering cap, and replaces verdicts by ID', () => {
  const history = Array.from({ length: 10001 }, (_, i) => event(i, 'alpha', 100, 'TESTING')) as Submission[];
  const snapshot = projectLiveUpdate(board() as Standings, [{ ...history[0], verdict: 'OK' }], history, ['alpha']);
  assert.equal(snapshot.submissions.length, 10001);
  assert.equal(snapshot.submissions.find((s) => s.id === 0)?.verdict, 'OK');
  const visible = projectVisible(snapshot.standings, snapshot.submissions, 7200, 3600);
  assert.equal(visible.standings.rows[0].points, 1);
  assert.ok(visible.submissions.length < history.length);
  assert.equal(projectLiveUpdate(snapshot.standings, [], snapshot.submissions, ['alpha']).submissions.length, 10001);
});
