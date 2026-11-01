import { test, expect } from '@playwright/test';
const contest = {id:42,name:'Codeforces Round 42',phase:'CODING',startTimeSeconds:1800000000,collectionState:'live',lastSuccessfulPoll:'2026-11-01T12:00:00Z',latestError:''};
const status = {contests:[contest],discoveryUpdatedAt:'2026-11-01T12:00:00Z',discoveryStale:false,latestError:'',waiting:0,capacity:3};
test('save, preserve selection across modes, and keep unsaved changes during timed refresh',async({page},testInfo)=>{
 await page.clock.install();
 let stored={mode:'off',selectedContestIds:[] as number[]};let discoveryCalls=0;
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT')stored=route.request().postDataJSON();await route.fulfill({json:stored});});
 await page.route('**/api/contests',async route=>{discoveryCalls++;await route.fulfill({json:status});});
 await page.goto('/');await expect(page.getByLabel('Collect Codeforces Round 42')).toBeVisible();
 await page.getByLabel('Collection mode').selectOption('selected');await page.getByLabel('Collect Codeforces Round 42').check();
 await page.getByLabel('Collection mode').selectOption('all');await page.getByLabel('Collection mode').selectOption('off');
 await page.clock.fastForward(15000);await expect.poll(()=>discoveryCalls).toBeGreaterThan(1);
 await expect(page.getByLabel('Collect Codeforces Round 42')).toBeChecked();await expect(page.getByRole('status').filter({hasText:'Unsaved changes'})).toBeVisible();
 await page.getByLabel('Collection mode').selectOption('selected');await page.getByRole('button',{name:'Save settings'}).click();
 await expect(page.locator('#message')).toContainText('Settings saved');expect(stored).toEqual({mode:'selected',selectedContestIds:[42]});
 await expect(page.getByRole('button',{name:'Save settings'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('admin.png'),fullPage:true});
});
test('failed save retains changes and can be retried',async({page})=>{
 let fail=true;
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){await route.fulfill(fail?{status:500,body:'save failed'}:{json:route.request().postDataJSON()});}else await route.fulfill({json:{mode:'off',selectedContestIds:[]}});});
 await page.route('**/api/contests',route=>route.fulfill({json:{...status,waiting:1,discoveryStale:true,latestError:'Discovery unavailable',contests:[{...contest,collectionState:'waiting'}]}}));
 await page.goto('/');await page.getByLabel('Collection mode').selectOption('all');await page.getByRole('button',{name:'Save settings'}).click();
 await expect(page.locator('#message')).toContainText('Your changes are still here');await expect(page.getByLabel('Collection mode')).toHaveValue('all');
 await expect(page.locator('#capacity')).toContainText('1 waiting');await expect(page.getByRole('alert')).toContainText('Discovery unavailable');
 fail=false;await page.getByRole('button',{name:'Save settings'}).click();await expect(page.locator('#message')).toContainText('Settings saved');
});
test('initial failure can be retried and empty contests are explained',async({page})=>{
 let fail=true;
 await page.route('**/api/settings',route=>route.fulfill(fail?{status:503,body:'unavailable'}:{json:{mode:'off',selectedContestIds:[]}}));
 await page.route('**/api/contests',route=>route.fulfill({json:{...status,contests:[]}}));
 await page.goto('/');await expect(page.locator('#message')).toContainText('Settings could not be loaded');await expect(page.getByLabel('Collection mode')).toBeDisabled();
 fail=false;await page.getByRole('button',{name:'Refresh status'}).click();await expect(page.getByText('No upcoming or running contests.',{exact:false})).toBeVisible();await expect(page.getByLabel('Collection mode')).toBeEnabled();
});
test('saving locks controls until persistence completes',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PUT'){await pending;await route.fulfill({json:route.request().postDataJSON()});}else await route.fulfill({json:{mode:'off',selectedContestIds:[]}});});
 await page.route('**/api/contests',route=>route.fulfill({json:status}));
 await page.goto('/');await page.getByLabel('Collection mode').selectOption('all');await page.getByRole('button',{name:'Save settings'}).click();
 await expect(page.getByRole('button',{name:'Saving…'})).toBeDisabled();await expect(page.getByLabel('Collection mode')).toBeDisabled();release();await expect(page.locator('#message')).toContainText('Settings saved');
});
