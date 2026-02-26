import { defineConfig } from '@playwright/test';

// E2E runs against the Next.js portals, which proxy /api/* to the backend.
// Tests are partitioned by portal so each spec's `page.goto('/')` resolves correctly.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  // CI runners are slower — give extra headroom for JIT compilation
  timeout: isCI ? 300_000 : 180_000,
  expect: {
    timeout: isCI ? 30_000 : 20_000,
  },
  retries: isCI ? 1 : 0,
  use: {
    trace: 'retain-on-failure',
    actionTimeout: isCI ? 45_000 : 30_000,
    navigationTimeout: isCI ? 90_000 : 60_000,
  },
  workers: isCI ? 1 : undefined,
  // Start the full stack for E2E. If you already have it running, Playwright will reuse it.
  webServer: {
    command: 'node scripts/dev-all.mjs --force',
    url: 'http://localhost:8080/api/health/e2e',
    reuseExistingServer: !isCI,
    // CI cold-starts 6 dev servers — needs generous startup window
    timeout: isCI ? 360_000 : 240_000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=4096', '--no-deprecation']
        .filter(Boolean)
        .join(' '),
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
