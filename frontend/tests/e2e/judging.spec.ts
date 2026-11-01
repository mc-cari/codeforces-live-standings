import { expect, test } from '@playwright/test';
import fixture from '../fixtures/codeforces-566-hacks.json';

for (const mode of ['standings', 'replay']) {
  test(`${mode}: wait for judging without counts and allow early manual reveal`, async ({ page }) => {
    const current = { ...fixture.standings.contest, phase: 'SYSTEM_TEST' };
    await page.route('**/api/codeforces?**', (route) => {
      const method = new URL(route.request().url()).searchParams.get('method');
      const results: Record<string, unknown> = { 'contest.info': current,
        'contest.standings': { ...fixture.standings, contest: current }, 'contest.hacks': fixture.hacks,
        'contest.status': fixture.submissions.map((event, index) => index !== 1 ? event : { ...event, verdict: 'TESTING' }),
        'user.info': [] };
      return route.fulfill({ json: { status: 'OK', result: results[method || ''] || [] } });
    });
    await page.goto(`/contests/566/${mode}?contestType=normal&handles=Misha100896&handles=fruwajacybyk&freezeMinutes=152&startTime=180&autoplay=false`);
    await expect(page.getByRole('button', { name: 'Start reveal', exact: true })).toBeDisabled();
    await expect(page.getByText('Waiting for judging', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/\d+ submissions? (awaiting|left|pending judging)/i)).toHaveCount(0);
    await expect(page.locator('[data-hack-id="160429"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal anyway', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: /Revealed/ })).toBeVisible();
    const announcement = page.getByRole('status').filter({ hasText: /Revealed/ });
    const before = await announcement.textContent();
    await page.getByRole('button', { name: 'Auto reveal', exact: true }).click();
    await expect(announcement).not.toHaveText(before || '');
    await page.getByRole('button', { name: 'Pause', exact: true }).last().click();
    if (mode === 'replay') {
      await page.getByLabel('Replay timeline').fill('5000');
      await expect(page.getByRole('button', { name: 'Start reveal', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Reveal anyway', exact: true })).toHaveCount(0);
    }
  });
}

test('live FINISHED contest continues polling pending verdicts and enables reveal when settled', async ({ page }) => {
  await page.clock.install();
  let pending = true;
  await page.route('**/api/codeforces?**', (route) => {
    const method = new URL(route.request().url()).searchParams.get('method');
    const results: Record<string, unknown> = { 'contest.info': fixture.standings.contest,
      'contest.standings': fixture.standings, 'contest.hacks': fixture.hacks,
      'contest.status': fixture.submissions.map((event, index) => index !== 1 || !pending ? event : { ...event, verdict: 'SUBMITTED' }),
      'user.info': [] };
    return route.fulfill({ json: { status: 'OK', result: results[method || ''] || [] } });
  });
  await page.goto('/contests/566/standings?contestType=normal&handles=Misha100896&handles=fruwajacybyk&freezeMinutes=152');
  await expect(page.getByRole('button', { name: 'Start reveal', exact: true })).toBeDisabled();
  pending = false;
  await page.clock.fastForward(31_000);
  await expect(page.getByRole('button', { name: 'Start reveal', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Reveal anyway', exact: true })).toHaveCount(0);
});
