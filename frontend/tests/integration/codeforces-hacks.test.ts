import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectVisible } from '../../src/shared/freeze/projection.ts';
import { hackCoverageIncomplete, sanitizeHack, type Hack } from '../../src/shared/domain/hacks.ts';
import type { ReplayStandings, ReplaySubmission } from '../../src/contexts/replay/domain/models.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/codeforces-566-hacks.json', import.meta.url), 'utf8'));

test('live Codeforces contest 566: replay hack scores match the current official standings', {
  skip: process.env.CF_LIVE_INTEGRATION !== '1', timeout: 120_000,
}, async () => {
  const api = async <T>(method: string, parameters: Record<string, string>): Promise<T> => {
    const response = await fetch(`https://codeforces.com/api/${method}?${new URLSearchParams(parameters)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `${method}: HTTP ${response.status}`);
    const payload = await response.json() as { status: string; result: T; comment?: string };
    assert.equal(payload.status, 'OK', `${method}: ${payload.comment || 'API failure'}`);
    // The public API allows only one request every two seconds.
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return payload.result;
  };
  const handles: string[] = fixture.source.handles;
  const selected = (party: { members: Array<{ handle: string }> }) =>
    party.members.some((member) => handles.includes(member.handle));
  const standings = await api<ReplayStandings>('contest.standings', { contestId: '566' });
  standings.rows = standings.rows.filter((row) => selected(row.party));
  const hacks = (await api<Hack[]>('contest.hacks', { contestId: '566' }))
    .filter((hack) => selected(hack.hacker) || selected(hack.defender)).map(sanitizeHack);
  const submissions: ReplaySubmission[] = [];
  for (const handle of handles) {
    submissions.push(...await api<ReplaySubmission[]>('contest.status', { contestId: '566', handle }));
  }
  assert.equal(hackCoverageIncomplete(standings, hacks, true), false, 'Upstream hack details are incomplete');
  assert.ok(hacks.some((hack) => hack.verdict === 'HACK_SUCCESSFUL'));
  assert.ok(hacks.some((hack) => hack.verdict === 'HACK_UNSUCCESSFUL'));
  assert.ok(submissions.some((submission) => submission.verdict === 'CHALLENGED'));
  const result = projectVisible(standings, submissions, standings.contest.durationSeconds,
    undefined, undefined, false, false, hacks);
  for (const row of standings.rows) {
    const replayed = result.standings.rows.find((candidate) => candidate.party.members[0].handle === row.party.members[0].handle)!;
    assert.equal(replayed.points, row.points, row.party.members[0].handle);
    assert.equal(replayed.successfulHackCount, row.successfulHackCount);
    assert.equal(replayed.unsuccessfulHackCount, row.unsuccessfulHackCount);
  }
});
