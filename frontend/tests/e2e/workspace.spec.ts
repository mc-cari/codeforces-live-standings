import { expect, test, type Page } from '@playwright/test';

const contest = {
  id: 1735,
  name: 'Codeforces Round 1735',
  type: 'CF',
  phase: 'CODING',
  frozen: false,
  durationSeconds: 7_200,
  startTimeSeconds: Math.floor(Date.now() / 1_000) - 600,
  relativeTimeSeconds: 600,
  preparedBy: '', websiteUrl: '', description: '', difficulty: 0,
  kind: '', icpcRegion: '', country: '', city: '', season: '',
};

const upcomingContest = {
  ...contest,
  id: 2246,
  name: 'Codeforces Round 2246',
  phase: 'BEFORE',
  startTimeSeconds: Math.floor(Date.now() / 1_000) + 90,
};

const party = {
  contestId: 1735,
  members: [{ handle: 'Tourist', name: 'Tourist' }],
  participantType: 'CONTESTANT',
  teamId: undefined,
  teamName: undefined,
  ghost: false,
  room: undefined,
  startTimeSeconds: contest.startTimeSeconds,
  rank: 1,
};

const standings = {
  contest,
  problems: [{
    contestId: 1735,
    problemSetName: '',
    index: 'A',
    name: 'Working Week',
    type: 'PROGRAMMING',
    points: 500,
    rating: 800,
    tags: [],
  }],
  rows: [{
    party,
    rank: 1,
    points: 500,
    penalty: 0,
    successfulHackCount: 0,
    unsuccessfulHackCount: 0,
    problemResults: [{
      points: 500,
      penalty: 0,
      rejectedAttemptCount: 0,
      type: 'FINAL',
      bestSubmissionTimeSeconds: 300,
    }],
    lastSubmissionTimeSeconds: 300,
  }],
};

const installCodeforcesMocks = async (page: Page, detectedContest = contest) => {
  const appRequests: string[] = [];
  await page.route('**/api/codeforces?**', async (route) => {
    const url = new URL(route.request().url());
    appRequests.push(url.toString());
    const method = url.searchParams.get('method');
    const result = {
      'contest.list': [contest, upcomingContest],
      'contest.info': detectedContest,
      'contest.standings': standings,
      'contest.status': [],
      'participant.import': ['Tourist', 'Benq'],
      'user.info': [{ handle: 'Tourist', rank: 'legendary grandmaster' }],
    }[method || ''] ?? [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'OK', result }) });
  });
  return appRequests;
};

test('setup is app-first and keeps imports behind contest detection', async ({ page }) => {
  const appRequests = await installCodeforcesMocks(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: /Your (friends|setup)\. One live scoreboard\./ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replay demo' })).toHaveAttribute('href', /\/contests\/1735\/replay\?/);
  await expect(page.getByText('Official standings')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Mini contest simulation' })
      .getByRole('heading', { name: 'Codeforces Contest' }),
  ).toBeVisible();
  await expect(page.getByTestId(`upcoming-countdown-${upcomingContest.id}`)).toHaveText(/^\d{2}:\d{2}:\d{2}$/);

  await page.getByRole('button', { name: /Codeforces Round 2246/ }).click();
  await expect(
    page.getByRole('region', { name: 'Mini contest simulation' })
      .getByRole('heading', { name: 'Codeforces Round 2246' }),
  ).toBeVisible();
  expect(appRequests.filter((request) => new URL(request).searchParams.get('method') === 'contest.info')).toHaveLength(0);

  await page.getByLabel('Codeforces contest ID').fill('1735');
  await expect(page.getByText('Codeforces Round 1735')).toBeVisible();
  await expect(page.getByText('Official standings')).toBeVisible();
  await expect(page.getByText('Import Codeforces friends automatically')).toBeVisible();
  await page.getByPlaceholder('your_handle,second_handle,').fill('preview_handle');
  await page.getByRole('button', { name: 'Add' }).click();
  const preview = page.getByRole('region', { name: 'Mini contest simulation' });
  await expect(preview.getByRole('heading', { name: 'Codeforces Round 1735' })).toBeVisible();
  await expect(preview.getByText('PTS', { exact: true })).toBeVisible();
  await expect(preview.getByText('Pen', { exact: true })).toHaveCount(0);
  await expect(preview.getByText('preview_handle')).toBeVisible();
  await expect(preview.getByRole('button')).toHaveCount(0);
  await expect(preview.getByRole('link', { name: 'Full replay' })).toHaveCount(0);

  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport();
  await page.waitForTimeout(1_500);
  const clockBeforeHandleToggle = await preview.getByTestId('mini-contest-clock').textContent();
  await page.getByRole('button', { name: 'Remove preview_handle' }).click();
  await expect(preview.getByText('preview_handle')).toHaveCount(0);
  await page.getByPlaceholder('your_handle,second_handle,').fill('preview_handle');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(preview.getByText('preview_handle')).toBeVisible();
  await page.waitForTimeout(1_500);
  const clockAfterHandleToggle = await preview.getByTestId('mini-contest-clock').textContent();
  expect(clockAfterHandleToggle).not.toBe('00:00:00');
  expect(clockAfterHandleToggle).not.toBe(clockBeforeHandleToggle);
});

test('friend credentials sign a direct request and never reach the app server', async ({ page }) => {
  const usage = await collectUsage(page);
  const appRequests = await installCodeforcesMocks(page);
  let friendRequest = '';
  await page.route('https://codeforces.com/api/user.friends?**', async (route) => {
    friendRequest = route.request().url();
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ status: 'OK', result: ['Tourist', 'Benq'] }),
    });
  });
  await page.goto('/');
  await page.getByLabel('Codeforces contest ID').fill('1735');
  await expect(page.getByText('Codeforces Round 1735')).toBeVisible();
  await page.getByText('Import Codeforces friends automatically').click();
  await page.getByLabel('Codeforces API key').fill('browser-key');
  await page.getByLabel('Codeforces API secret').fill('super-secret');
  await page.getByRole('button', { name: 'Import friend list' }).click();

  await expect(page.getByText('Added 2 friend handles.')).toBeVisible();
  expect(friendRequest).toContain('apiKey=browser-key');
  expect(friendRequest).toContain('apiSig=');
  expect(friendRequest).not.toContain('super-secret');
  expect(appRequests.join('\n')).not.toContain('browser-key');
  expect(appRequests.join('\n')).not.toContain('super-secret');
  await expect(page.getByLabel('Codeforces API secret')).toHaveValue('');
  expect(JSON.stringify(usage)).not.toContain('browser-key');
  expect(JSON.stringify(usage)).not.toContain('super-secret');
  expect(usage.filter((event) => event.kind === 'view_displayed')).toHaveLength(0);
});

test('mini contest preview has no inline controls', async ({ page }) => {
  await installCodeforcesMocks(page);
  await page.goto('/');
  const preview = page.getByRole('region', { name: 'Mini contest simulation' });
  await expect(preview.getByRole('button')).toHaveCount(0);
  await expect(preview.getByRole('link', { name: 'Full replay' })).toHaveCount(0);

  await page.goto('/contests/1735/replay?contestType=normal&demo=true&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('live desk exposes synchronization status and responsive standings tabs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile panel assertions only apply to the mobile project');
  await installCodeforcesMocks(page);
  await page.goto('/contests/1735/standings?contestType=normal&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause live' })).toHaveCount(0);

  await expect(page.getByRole('tab', { name: 'standings' })).toBeVisible();
  await page.getByRole('tab', { name: 'submissions' }).click();
  await expect(page.getByRole('region', { name: 'Live submissions' })).toBeVisible();
});


type UsageEvent = { id: string; kind: string; mode: string; seconds?: number };
const collectUsage = async (page: Page, fail = false) => {
  const events: UsageEvent[] = [];
  await page.route('**/api/telemetry', async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: fail ? 503 : 204 });
  });
  return events;
};

for (const phase of ['CODING', 'FINISHED']) {
  test(`successful ${phase} setup adds one setup and view, refresh adds only views`, async ({ page }) => {
    const events = await collectUsage(page);
    await installCodeforcesMocks(page, { ...contest, phase });
    await page.goto('/');
    await page.getByLabel('Codeforces contest ID').fill('1735');
    await expect(page.getByText('Codeforces Round 1735')).toBeVisible();
    await page.getByPlaceholder('your_handle,second_handle,').fill('Tourist');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: phase === 'FINISHED' ? 'Start Replay' : 'Start Live Tracking' }).click();
    await expect(page.getByTestId('contest-ribbon')).toBeVisible();
    await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(1);
    expect(events.filter((event) => event.kind === 'setup_completed').map((event) => event.mode))
      .toEqual([phase === 'FINISHED' ? 'replay' : 'live']);
    expect(events.filter((event) => event.kind === 'page_view')).toHaveLength(2);
    await page.reload();
    await expect(page.getByTestId('contest-ribbon')).toBeVisible();
    await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(2);
    expect(events.filter((event) => event.kind === 'setup_completed').map((event) => event.mode))
      .toEqual([phase === 'FINISHED' ? 'replay' : 'live']);
    expect(events.filter((event) => event.kind === 'page_view')).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain('Tourist');
    expect(JSON.stringify(events.map((event) => ({ ...event, id: undefined })))).not.toContain('1735');
  });
}

test('demo link counts a demo view and controls do not add views', async ({ page }) => {
  const events = await collectUsage(page);
  await installCodeforcesMocks(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Replay demo', exact: true }).click();
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(1);
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await pause.click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  expect(events.filter((event) => event.kind === 'view_displayed').map((event) => event.mode)).toEqual(['demo']);
  expect(events.filter((event) => event.kind === 'setup_completed')).toHaveLength(0);
  expect(events.filter((event) => event.kind === 'page_view').map((event) => event.mode)).toEqual(['setup', 'demo']);
});

test('failed direct replay reports failure and telemetry outage leaves navigation usable', async ({ page }) => {
  const events = await collectUsage(page, true);
  await installCodeforcesMocks(page);
  await page.route('**/demo/1735-v1.json', (route) => route.fulfill({ status: 502 }));
  await page.goto('/contests/1735/replay?contestType=normal&demo=true&h=VG91cmlzdA');
  await expect(page.getByText('Unable to load demo replay')).toBeVisible();
  await expect.poll(() => events.filter((event) => event.kind === 'loading_failed').length).toBe(3);
  expect(new Set(events.filter((event) => event.kind === 'loading_failed').map((event) => event.id)).size).toBe(1);
  expect(events.filter((event) => event.kind === 'view_displayed')).toHaveLength(0);
  await page.goto('/');
  await expect(page.getByLabel('Codeforces contest ID')).toBeVisible();
});

test('countdown counts separately and transitions to a single live view', async ({ page }) => {
  const events = await collectUsage(page);
  await page.clock.install();
  await installCodeforcesMocks(page, { ...contest, phase: 'BEFORE', startTimeSeconds: Math.floor(Date.now() / 1000) + 120 });
  await page.goto('/contests/1735/standings?contestType=normal&h=VG91cmlzdA');
  await expect(page.getByText('Contest starts in')).toBeVisible();
  await expect.poll(() => events.filter((event) => event.kind === 'countdown_view').length).toBe(1);
  expect(events.filter((event) => event.kind === 'view_displayed')).toHaveLength(0);
  await page.clock.fastForward(121_000);
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect.poll(() => events.filter((event) => event.kind === 'view_displayed').length).toBe(1);
  expect(events.find((event) => event.kind === 'view_displayed')?.seconds).toBeLessThan(30);
  expect(events.filter((event) => event.kind === 'setup_completed')).toHaveLength(0);
});

test('invalid replay links show validation without a loading failure', async ({ page }) => {
  const events = await collectUsage(page);
  let loads = 0;
  await page.route('**/api/codeforces?**', async (route) => {
    loads++;
    await route.fulfill({ status: 502 });
  });
  await page.goto('/contests/1735/replay?contestType=normal');
  await expect(page.getByText('Replay requires a contest, contest type, and participant handles')).toBeVisible();
  await expect.poll(() => events.filter((event) => event.kind === 'page_view').length).toBe(1);
  expect(events.filter((event) => event.kind === 'loading_failed')).toHaveLength(0);
  expect(loads).toBe(0);
});
