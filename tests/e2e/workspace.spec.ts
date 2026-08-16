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

const installCodeforcesMocks = async (page: Page) => {
  const appRequests: string[] = [];
  await page.route('**/api/codeforces?**', async (route) => {
    const url = new URL(route.request().url());
    appRequests.push(url.toString());
    const method = url.searchParams.get('method');
    const result = {
      'contest.list': [contest],
      'contest.info': contest,
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
  await installCodeforcesMocks(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('heading', { name: 'Your friends. One live scoreboard.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replay demo' })).toHaveAttribute('href', /\/contests\/1735\/replay\?/);
  await expect(page.getByText('Official standings')).toHaveCount(0);
  await expect(page.getByText('Pocket Invitational')).toBeVisible();

  await page.getByLabel('Codeforces contest ID').fill('1735');
  await expect(page.getByText('Codeforces Round 1735')).toBeVisible();
  await expect(page.getByText('Official standings')).toBeVisible();
  await expect(page.getByText('Import Codeforces friends automatically')).toBeVisible();
  await page.getByPlaceholder('your_handle,second_handle,').fill('preview_handle');
  await page.getByRole('button', { name: 'Add' }).click();
  const preview = page.getByRole('region', { name: 'Mini contest simulation' });
  await expect(preview.getByRole('heading', { name: 'Codeforces Round 1735' })).toBeVisible();
  await expect(preview.getByText('preview_handle')).toBeVisible();
  await expect(preview.getByRole('button')).toHaveCount(0);
  await expect(preview.getByRole('link')).toHaveCount(0);
});

test('friend credentials sign a direct request and never reach the app server', async ({ page }) => {
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
});

test('mini contest preview has no inline controls', async ({ page }) => {
  await installCodeforcesMocks(page);
  await page.goto('/');
  const preview = page.getByRole('region', { name: 'Mini contest simulation' });
  await expect(preview.getByRole('button')).toHaveCount(0);
  await expect(preview.getByRole('link')).toHaveCount(0);

  await page.goto('/contests/1735/replay?contestType=normal&demo=true&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('live desk exposes pause and responsive standings tabs', async ({ page }) => {
  await installCodeforcesMocks(page);
  await page.goto('/contests/1735/standings?contestType=normal&h=VG91cmlzdA');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  const pause = page.getByRole('button', { name: 'Pause live' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Resume live' })).toBeVisible();

  if (page.viewportSize() && page.viewportSize()!.width < 1024) {
    await expect(page.getByRole('tab', { name: 'standings' })).toBeVisible();
    await page.getByRole('tab', { name: 'submissions' }).click();
    await expect(page.getByRole('region', { name: 'Live submissions' })).toBeVisible();
  }
});
