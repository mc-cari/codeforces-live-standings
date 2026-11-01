import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'./tests', fullyParallel:true,
 use:{baseURL:'http://127.0.0.1:4321'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
 webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:4321',reuseExistingServer:!process.env.CI},
});
