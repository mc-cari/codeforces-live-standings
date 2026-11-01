import { expect, test } from '@playwright/test';

test('SSE reconnects preserve one displayed view and initial connection errors count failures', async ({ page }) => {
  const events: { kind: string; mode: string }[] = [];
  const contest = { id: 1735, name: 'SSE contest', type: 'CF', phase: 'CODING', durationSeconds: 7200, startTimeSeconds: 1, relativeTimeSeconds: 100 };
  const snapshot = { revision: 1, contest, standings: { contest, problems: [], rows: [] }, submissions: [], health: { state: 'live' } };
  await page.route('**/api/telemetry', async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/codeforces?**', (route) => {
    const result = new URL(route.request().url()).searchParams.get('method') === 'contest.info' ? contest : [];
    return route.fulfill({ json: { status: 'OK', result } });
  });
  await page.route('**/v1/contests/1735/activate', (route) => route.fulfill({ json: { state: 'live', contest } }));
  let connections = 0;
  await page.route('**/v1/contests/1735/events?**', async (route) => {
    connections++;
    // Closing the response triggers native EventSource reconnection. The first
    // attempt fails before a snapshot; later attempts replay the snapshot.
    await route.fulfill({
      contentType: 'text/event-stream',
      body: connections === 1 ? 'retry: 100\n\n' : `retry: 100\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
    });
  });
  await page.goto('/contests/1735/standings?contestType=normal&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect.poll(() => connections).toBeGreaterThanOrEqual(3);
  await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(1);
  expect(events.filter((event) => event.kind === 'loading_failed')).toHaveLength(1);
  expect(events.filter((event) => event.kind === 'page_view')).toHaveLength(1);
  expect(events.filter((event) => event.kind === 'setup_completed')).toHaveLength(0);
});

test('SSE loads standings when the initial contest-info request fails', async ({ page }) => {
  const contest = { id: 1735, name: 'Recovered SSE contest', type: 'CF', phase: 'CODING', durationSeconds: 7200, startTimeSeconds: 1, relativeTimeSeconds: 100 };
  const snapshot = { revision: 1, contest, standings: { contest, problems: [], rows: [] }, submissions: [], health: { state: 'live' } };
  const events: { kind: string }[] = [];
  await page.route('**/api/telemetry', async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/codeforces?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('method') === 'contest.info') {
      return route.fulfill({ status: 502, json: { status: 'FAILED', comment: 'Contest info unavailable' } });
    }
    return route.fulfill({ json: { status: 'OK', result: [] } });
  });
  await page.route('**/v1/contests/1735/activate', (route) => route.fulfill({ json: { state: 'live', contest } }));
  await page.route('**/v1/contests/1735/events?**', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
  }));
  await page.goto('/contests/1735/standings?contestType=normal&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect(page.getByTestId('contest-ribbon')).toContainText('Recovered SSE contest');
  await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(1);
});

test('SSE hack upserts replace verdicts, survive reconnects and reveal once for two selected participants', async ({ page }) => {
  const start = Math.floor(Date.now() / 1000) - 7200;
  const contest = { id: 566, name: 'Hack SSE contest', type: 'CF', phase: 'FINISHED', durationSeconds: 7200,
    startTimeSeconds: start, relativeTimeSeconds: 7200 };
  const party = (handle: string) => ({ members: [{ handle }], participantType: 'CONTESTANT' });
  const standings = { contest, problems: [{ index: 'A', name: 'Problem A' }], rows: ['alpha', 'beta'].map((name, index) => ({
    party: party(name), rank: index + 1, points: index ? 0 : 100, penalty: 0,
    successfulHackCount: index ? 0 : 1, unsuccessfulHackCount: 0,
    problemResults: [{ points: 0, penalty: 0, rejectedAttemptCount: 0, bestSubmissionTimeSeconds: 0 }],
  })) };
  const hack = { id: 1, creationTimeSeconds: start + 4000, hacker: party('alpha'), defender: party('beta'),
    problem: { index: 'A' }, verdict: 'HACK_UNSUCCESSFUL' };
  const submission = { id: 1, contestId: 566, creationTimeSeconds: start + 100, relativeTimeSeconds: 100,
    author: party('alpha'), problem: { index: 'A' }, verdict: 'CHALLENGED' };
  const snapshot = { revision: 1, contest, standings, submissions: [submission], hacks: [hack], hacksIncomplete: true };
  const patch = { revision: 2, contest, standings, submissionUpserts: [],
    hackUpserts: [{ ...hack, verdict: 'HACK_SUCCESSFUL' }], hacksIncomplete: false };
  await page.route('**/api/codeforces?**', (route) => route.fulfill({ json: { status: 'OK', result:
    new URL(route.request().url()).searchParams.get('method') === 'contest.info' ? contest : [] } }));
  await page.route('**/v1/contests/566/activate', (route) => route.fulfill({ json: { state: 'live', contest } }));
  await page.route('**/v1/contests/566/events?**', (route) => route.fulfill({ contentType: 'text/event-stream',
    body: `retry: 100
 event: snapshot
data: ${JSON.stringify(snapshot)}

event: patch
data: ${JSON.stringify(patch)}

`.replace(' event:', 'event:') }));
  await page.goto('/contests/566/standings?contestType=normal&handles=alpha&handles=beta&freezeMinutes=60');
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await expect(page.locator('[data-hack-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start reveal' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Reveal complete', { exact: true })).toBeVisible();
  await expect(page.locator('[data-hack-id="1"]')).toHaveCount(1);
  await expect(page.locator('[data-hack-id="1"]')).toContainText('+100');
  await expect(page.locator('[data-feed-key="submission:1"]')).toHaveCount(1);
  await expect(page.locator('[data-feed-key="hack:1"]')).toHaveCount(1);
  await expect(page.locator('[data-hack-id="1"]')).not.toContainText('-50');
});
