import { expect, test, type Page } from '@playwright/test';

const contest = { id: 1735, name: 'Freeze test contest', type: 'ICPC', phase: 'FINISHED',
  durationSeconds: 7200, startTimeSeconds: Math.floor(Date.now() / 1000) - 7200, relativeTimeSeconds: 7200 };
const party = (handle: string) => ({ members: [{ handle }], participantType: 'CONTESTANT' });
const problems = ['A', 'B'].map((index) => ({ index, name: `Problem ${index}`, points: 500 }));
const standings = { contest, problems, rows: ['alpha', 'beta'].map((handle, index) => ({
  party: party(handle), rank: index + 1, points: index ? 1 : 2, penalty: index ? 65 : 126,
  problemResults: problems.map((_, i) => ({ points: index && i ? 0 : 1, penalty: 63,
    rejectedAttemptCount: 0, bestSubmissionTimeSeconds: 3800, type: 'FINAL' })),
})) };
const submissions = [
  { id: 1, author: party('alpha'), problem: problems[0], relativeTimeSeconds: 100 },
  { id: 2, author: party('alpha'), problem: problems[1], relativeTimeSeconds: 3600 },
  { id: 3, author: party('beta'), problem: problems[0], relativeTimeSeconds: 3900 },
].map((submission) => ({ ...submission, contestId: 1735, verdict: 'OK', passedTestCount: 10,
  creationTimeSeconds: contest.startTimeSeconds + submission.relativeTimeSeconds,
  programmingLanguage: 'C++17', testset: 'TESTS', timeConsumedMillis: 1, memoryConsumedBytes: 1024 }));

async function mocks(page: Page, phase = 'FINISHED') {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { sessionStorage.setItem('copiedSetup', value); },
    } });
  });
  await page.route('**/api/codeforces?**', (route) => {
    const method = new URL(route.request().url()).searchParams.get('method');
    const current = { ...contest, phase };
    const results: Record<string, unknown> = { 'contest.info': current, 'contest.list': [current],
      'contest.standings': { ...standings, contest: current }, 'contest.status': submissions, 'user.info': [] };
    return route.fulfill({ json: { status: 'OK', result: results[method || ''] || [] } });
  });
}
const link = (mode: 'replay' | 'standings') => `/contests/1735/${mode}?contestType=educational&handles=alpha&handles=beta&freezeMinutes=60&startTime=120&autoplay=false`;

for (const mode of ['standings', 'replay'] as const) {
  test(`${mode}: late arrival hides both panels, unfreeze persists across refresh`, async ({ page }, info) => {
    await mocks(page);
    await page.goto(link(mode));
    await expect(page.getByText(/Standings frozen/)).toBeVisible();
    await expect(page.getByLabel('1 pending submissions')).toHaveCount(2);
    const panel = page.getByRole('region', { name: mode === 'replay' ? 'Replay submissions' : 'Live submissions', includeHidden: true });
    await expect(panel.locator('a[href*="/submission/"]')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('frozen.png'), fullPage: true });
    await page.getByRole('button', { name: 'Unfreeze now' }).click();
    await expect(page).toHaveURL(/freezeView=unfrozen/);
    await expect(page.getByLabel('1 pending submissions')).toHaveCount(0);
    await expect(panel.locator('a[href*="/submission/"]')).toHaveCount(3);
    await page.reload();
    await expect(page.getByText('Standings unfrozen', { exact: true })).toBeVisible();
    await expect(panel.locator('a[href*="/submission/"]')).toHaveCount(3);
  });

  test(`${mode}: manual and automatic ceremony reconcile and respect reduced motion`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mocks(page);
    await page.goto(link(mode));
    await page.getByRole('button', { name: 'Start reveal' }).click();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Revealed beta, problem A.' })).toBeVisible();
    await expect(page.getByLabel('1 pending submissions')).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('revealing.png'), fullPage: true });
    await page.getByRole('button', { name: 'Auto reveal' }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Auto reveal' })).toBeVisible();
    await page.getByRole('button', { name: 'Auto reveal' }).click();
    await expect(page.getByText('Reveal complete', { exact: true })).toBeVisible();
    await expect(page.getByLabel('1 pending submissions')).toHaveCount(0);
    if (mode === 'replay') {
      await page.getByLabel('Replay timeline').fill('4000');
      await expect(page.getByText(/Standings frozen/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Start reveal' })).toBeDisabled();
      await page.getByLabel('Replay timeline').fill('100');
      await expect(page.getByText('Freezes at 01:00', { exact: true })).toBeVisible();
      await expect(page.getByLabel('1 pending submissions')).toHaveCount(0);
    }
  });
}

test('setup validates freeze minutes and passes settings to the selected route', async ({ page }) => {
  await mocks(page);
  await page.goto('/');
  await page.getByLabel('Codeforces contest ID').fill('1735');
  await expect(page.getByText('Freeze test contest', { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder('your_handle,second_handle,').fill('alpha,beta');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Freeze standings', { exact: true }).check();
  const input = page.getByLabel('Freeze minutes');
  await expect(input).toHaveValue('60');
  await input.fill('120');
  await expect(page.getByRole('button', { name: 'Start Replay' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Share setup' })).toBeDisabled();
  await input.fill('0.5');
  await expect(page.getByRole('button', { name: 'Start Replay' })).toBeDisabled();
  await input.fill('60');
  await expect(page.getByText('Freezes at 01:00 from contest start.')).toBeVisible();
  await page.getByRole('button', { name: 'Share setup' }).click();
  await expect(page.getByText('Link copied.', { exact: true })).toBeVisible();
  const shared = new URL((await page.evaluate(() => sessionStorage.getItem('copiedSetup')))!);
  expect(shared.pathname).toBe('/contests/1735/replay');
  expect(shared.searchParams.get('freezeMinutes')).toBe('60');
  expect(shared.searchParams.get('h')).toBeTruthy();
  await page.getByRole('button', { name: 'Start Replay' }).click();
  await expect(page).toHaveURL(/freezeMinutes=60/);
});

test('malformed freeze URL disables freezing with a warning', async ({ page }) => {
  await mocks(page);
  await page.goto(link('replay').replace('freezeMinutes=60', 'freezeMinutes=120'));
  await expect(page.getByText('Invalid freeze settings. Freezing is disabled.')).toBeVisible();
  await expect(page.getByLabel('1 pending submissions')).toHaveCount(0);
});

test('live ceremony waits for FINISHED while instant unfreeze stays available', async ({ page }) => {
  await mocks(page, 'CODING');
  await page.goto(link('standings'));
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start reveal' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Unfreeze now' })).toBeEnabled();
});

test('replay sharing captures timeline, speed and the persistent unfrozen view', async ({ page }) => {
  await mocks(page);
  await page.goto(link('replay'));
  await page.getByRole('button', { name: 'Unfreeze now' }).click();
  await expect(page).toHaveURL(/freezeView=unfrozen/);
  await expect(page.getByText('Standings unfrozen', { exact: true })).toBeVisible();
  await page.getByLabel('Replay timeline').fill('4000');
  await expect(page.getByTestId('contest-ribbon')).toContainText('01:06:40');
  await page.getByRole('combobox', { name: 'Speed' }).selectOption('15');
  await page.getByRole('button', { name: 'Share setup' }).click();
  await expect(page.getByText('Link copied.', { exact: true })).toBeVisible();
  const shared = new URL((await page.evaluate(() => sessionStorage.getItem('copiedSetup')))!);
  expect(Number(shared.searchParams.get('startTime')) * 60).toBeCloseTo(4000);
  expect(shared.searchParams.get('playbackSpeed')).toBe('15');
  expect(shared.searchParams.get('autoplay')).toBe('false');
  expect(shared.searchParams.get('freezeView')).toBe('unfrozen');
  expect(shared.searchParams.getAll('handles')).toEqual(['alpha', 'beta']);
  await page.goto(shared.href);
  await expect(page.getByTestId('contest-ribbon')).toContainText('01:06:40');
  await expect(page.getByRole('combobox', { name: 'Speed' })).toHaveValue('15');
  await expect(page.getByText('Standings unfrozen', { exact: true })).toBeVisible();
});

test('sharing provides a selectable URL when clipboard permission is unavailable', async ({ page }) => {
  await mocks(page);
  await page.goto(link('standings'));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard unavailable'); },
    } });
  });
  await page.getByRole('button', { name: 'Share setup' }).click();
  await expect(page.getByLabel('Share link')).toHaveValue(/freezeMinutes=60/);
  await page.getByLabel('Share link').focus();
  expect(await page.getByLabel('Share link').evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!))
    .toBeGreaterThan(0);
});
