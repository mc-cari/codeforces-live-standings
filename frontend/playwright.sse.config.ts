import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/sse.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:3001' },
  webServer: {
    command: 'pnpm dev --port 3001',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_PUBLIC_LIVE_API_BASE_URL: 'http://127.0.0.1:3001' },
  },
});
