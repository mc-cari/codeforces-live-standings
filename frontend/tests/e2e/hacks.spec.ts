import { expect, test, type Page } from '@playwright/test';
import fixture from '../fixtures/codeforces-566-hacks.json';

const url = '/contests/566/replay?contestType=normal&handles=Misha100896&handles=fruwajacybyk&autoplay=false';
const score = (page: Page, handle = 'Misha100896') => page.locator(`[data-standings-row="${handle}"] > div`).nth(1);
const feed = (page: Page) => page.getByRole('region', { name: 'Replay submissions', includeHidden: true });
async function selectPanel(page: Page, name: 'submissions' | 'standings') {
  const tab = page.getByRole('tab', { name, exact: true });
  if (await tab.isVisible()) await tab.click();
}
async function mock(page: Page, getHacks = () => fixture.hacks, fail = () => false) {
  await page.route('**/api/codeforces?**', (route) => {
    const method = new URL(route.request().url()).searchParams.get('method');
    if (method === 'contest.hacks' && fail()) return route.fulfill({ status: 503, json: { status: 'FAILED' } });
    const results: Record<string, unknown> = { 'contest.info': fixture.standings.contest,
      'contest.standings': fixture.standings, 'contest.status': fixture.submissions,
      'contest.hacks': getHacks(), 'user.info': [] };
    return route.fulfill({ json: { status: 'OK', result: results[method || ''] || [] } });
  });
}

test('contest 566: mixed replay feed changes scores at real hack timestamps and preserves CHALLENGED on seeks', async ({ page }, info) => {
  await mock(page);
  await page.goto(url + '&startTime=0');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  const timeline = page.getByLabel('Replay timeline');
  await timeline.fill('1677');
  await expect(score(page)).toHaveText('410');
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(0);
  await timeline.fill('1678');
  await expect(score(page)).toHaveText('360');
  await expect(feed(page).locator('[data-hack-id="160427"]')).toContainText('-50');
  await expect(feed(page).locator('[data-hack-id="160427"]')).toContainText('fruwajacybyk');
  await timeline.fill('1940');
  await expect(score(page)).toHaveText('310');
  await timeline.fill('1941');
  await expect(score(page)).toHaveText('410');
  await expect(feed(page).locator('[data-hack-id="160429"]')).toContainText('+100');
  await selectPanel(page, 'submissions');
  await page.waitForTimeout(500); // capture after the authored row movement has settled
  await page.screenshot({ path: info.outputPath('real-hacks-feed.png'), fullPage: true });
  await timeline.fill('1000');
  await expect(feed(page).locator('[data-feed-key="submission:12277531"]')).toContainText('CH');
  await timeline.fill('10800');
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(18);
  await selectPanel(page, 'standings');
  await expect(score(page)).toHaveText('690');
  await expect(score(page, 'fruwajacybyk')).toHaveText('150');
  await expect(page.getByText('Hack details may be incomplete')).toHaveCount(0);
});

test('contest 566: freeze hides hack details and score effects; manual/automatic reveal is atomic and seek resets it', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mock(page);
  // Cutoff 1680 shows the first hack and hides all subsequent hacks.
  await page.goto(url + '&freezeMinutes=152&startTime=180');
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await expect(score(page)).toHaveText('360'); // cutoff 1680: only hack 160427 is visible
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(1);
  await expect(feed(page).locator('[data-hack-id="160429"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start reveal' }).click();
  let manualRevealed = false;
  for (let index = 0; index < 15; index++) {
    const before = await feed(page).locator('[data-hack-id]').count();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (await feed(page).locator('[data-hack-id]').count() > before) { manualRevealed = true; break; }
  }
  expect(manualRevealed).toBe(true);
  await expect(feed(page).locator('[data-hack-id="160428"]')).toContainText('-50');
  await page.getByRole('button', { name: 'Auto reveal' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Auto reveal' })).toBeVisible();
  await page.getByRole('button', { name: 'Auto reveal' }).click();
  await expect(page.getByText('Reveal complete', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(score(page)).toHaveText('690');
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(18);
  await selectPanel(page, 'submissions');
  await page.screenshot({ path: info.outputPath('revealed-hacks-reduced-motion.png'), fullPage: true });
  await page.getByLabel('Replay timeline').fill('7000');
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(1);
});

for (const selected of ['Misha100896', 'fruwajacybyk']) {
  test(`contest 566: include hack once when only ${selected} is selected`, async ({ page }) => {
    await mock(page);
    await page.goto(`/contests/566/replay?contestType=normal&handles=${selected}&autoplay=false&startTime=180`);
    await expect(page.getByTestId('contest-ribbon')).toBeVisible();
    await expect(page.locator('[data-hack-id="160429"]')).toHaveCount(1);
    await expect(page.locator('[data-hack-id="160429"]')).toContainText('Misha100896');
    await expect(page.locator('[data-hack-id="160429"]')).toContainText('fruwajacybyk');
    await expect(page.locator('[data-standings-row]')).toHaveCount(1);
  });
}

test('failed hack enrichment keeps replay available and Retry recovers known omissions without duplicates', async ({ page }) => {
  let failed = true;
  let partial = true;
  await mock(page, () => partial ? fixture.hacks.slice(0, 1) : fixture.hacks, () => failed);
  await page.goto(url + '&freezeMinutes=152&startTime=180');
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await selectPanel(page, 'submissions');
  await expect(page.getByText('Hack details may be incomplete')).toBeVisible();
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(1);
  await expect(page.getByText('Hack details may be incomplete')).toBeVisible();
  partial = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Hack details may be incomplete')).toHaveCount(0);
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(1); // remaining hacks stay hidden
  await page.getByRole('button', { name: 'Unfreeze now' }).click();
  await expect(feed(page).locator('[data-hack-id]')).toHaveCount(18);
  await selectPanel(page, 'standings');
  await expect(score(page)).toHaveText('690');
});

test('live crossing the cutoff preserves observed official hack points when event details are unavailable', async ({ page }) => {
  const start = Math.floor(Date.now() / 1000) - 3590;
  let points = 100;
  const contest = { ...fixture.standings.contest, startTimeSeconds: start, durationSeconds: 7200,
    relativeTimeSeconds: 3590, phase: 'CODING' };
  const rows = fixture.standings.rows.map((row, index) => ({ ...row, points: index ? 0 : points,
    problemResults: row.problemResults.map((cell) => ({ ...cell, points: 0, penalty: 0 })) }));
  await page.clock.install();
  await page.route('**/api/codeforces?**', (route) => {
    const method = new URL(route.request().url()).searchParams.get('method');
    const results: Record<string, unknown> = { 'contest.info': contest, 'contest.status': [], 'contest.hacks': [],
      'contest.standings': { ...fixture.standings, contest, rows: rows.map((row, index) => ({ ...row, points: index ? 0 : points })) },
      'user.info': [] };
    return route.fulfill({ json: { status: 'OK', result: results[method || ''] || [] } });
  });
  await page.goto('/contests/566/standings?contestType=normal&handles=Misha100896&handles=fruwajacybyk&freezeMinutes=60');
  await expect(page.getByText('Freezes at 01:00', { exact: true })).toBeVisible();
  await expect(score(page)).toHaveText('100');
  await page.clock.fastForward(12_000);
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  points = 500;
  await page.clock.fastForward(3000);
  await expect(score(page)).toHaveText('100');
  await page.getByRole('button', { name: 'Unfreeze now' }).click();
  await expect(score(page)).toHaveText('500');
});

test('late live arrival hides actual hack rows and restores authoritative totals on unfreeze', async ({ page }) => {
  await mock(page);
  await page.goto(url.replace('/replay?', '/standings?') + '&freezeMinutes=152');
  await expect(page.getByText(/Standings frozen/)).toBeVisible();
  await expect(page.locator('[data-hack-id]')).toHaveCount(1);
  await expect(score(page)).toHaveText('360');
  await expect(page.locator('[data-hack-id="160429"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Unfreeze now' }).click();
  await expect(page.locator('[data-hack-id]')).toHaveCount(18);
  await expect(score(page)).toHaveText('690');
});

test('live final hack retries are spaced 30 seconds apart and stop after coverage recovers', async ({ page }) => {
  let calls = 0;
  let failed = true;
  await page.clock.install();
  await mock(page, () => fixture.hacks, () => { calls++; return failed; });
  await page.goto(url.replace('/replay?', '/standings?'));
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await expect.poll(() => calls).toBe(1);
  await page.clock.fastForward(29_000);
  expect(calls).toBe(1);
  await page.clock.fastForward(1000);
  await expect.poll(() => calls).toBe(2);
  failed = false;
  await page.clock.fastForward(30_000);
  await expect.poll(() => calls).toBe(3);
  await expect(page.getByText('Hack details may be incomplete')).toHaveCount(0);
  await page.clock.fastForward(60_000);
  expect(calls).toBe(3);
});

test('post-contest hack is shown at the replay terminal position with an After contest label', async ({ page }) => {
  const later = { ...fixture.hacks[0], id: 999999,
    creationTimeSeconds: fixture.standings.contest.startTimeSeconds + fixture.standings.contest.durationSeconds + 100 };
  await mock(page, () => [...fixture.hacks, later]);
  await page.goto(url + '&startTime=0');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  await page.getByLabel('Replay timeline').fill('10799');
  await expect(page.locator('[data-hack-id="999999"]')).toHaveCount(0);
  await page.getByLabel('Replay timeline').fill('10800');
  await expect(page.locator('[data-hack-id="999999"]')).toContainText('After contest');
});

test('real CHALLENGED verdict stays CH during normal-speed playback across its submission time', async ({ page }) => {
  await mock(page);
  await page.goto(url + '&startTime=14.85');
  await expect(page.getByTestId('contest-ribbon')).toBeVisible();
  // Submission 12277531 was created at 893s and its current verdict is CHALLENGED.
  const row = page.locator('[data-feed-key="submission:12277531"]');
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(row).toHaveCount(1);
  // Assert the first displayed verdict, before an artificial judging job could settle.
  await expect(row).toContainText('CH', { timeout: 200 });
  await page.waitForTimeout(500);
  await expect(row).toContainText('CH');
});
