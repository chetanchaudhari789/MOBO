import { defineConfig } from '@playwright/test';

// E2E runs against the Next.js portals, which proxy /api/* to the backend.
// Tests are partitioned by portal so each spec's `page.goto('/')` resolves correctly.
export default defineConfig({
  testDir: './e2e',
  reporter: [['list']],
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    trace: 'retain-on-failure',
  },
  // Start the full stack for E2E. If you already have it running, Playwright will reuse it.
  webServer: {
    command: 'node scripts/dev-all.mjs --force',
    url: 'http://localhost:8080/api/health/e2e',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      SEED_E2E: 'true',
    },
  },
  projects: [
    {
      name: 'buyer',
      testMatch: [/buyer\..*\.spec\.ts$/, /lifecycle\..*\.spec\.ts$/],
      use: { baseURL: 'http://localhost:3001' },
    },
    {
      name: 'mediator',
      testMatch: [/mediator\..*\.spec\.ts$/],
      use: { baseURL: 'http://localhost:3002' },
    },
    {
      name: 'agency',
      testMatch: [/agency\..*\.spec\.ts$/],
      use: { baseURL: 'http://localhost:3003' },
    },
    {
      name: 'brand',
      testMatch: [/brand\..*\.spec\.ts$/],
      workers: 1,
      use: { baseURL: 'http://localhost:3004' },
    },
    {
      name: 'admin',
      testMatch: [/admin\..*\.spec\.ts$/],
      use: { baseURL: 'http://localhost:3005' },
    },
  ],
});
