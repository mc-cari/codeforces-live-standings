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
