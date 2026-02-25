import { defineConfig } from '@playwright/test';

/**
 * Lightweight browser E2E config — tests one portal at a time.
 * Usage: PORTAL=buyer npx playwright test -c playwright.browser.config.ts
 */
const portal = process.env.PORTAL || 'buyer';
const portMap: Record<string, number> = {
  buyer: 3001, mediator: 3002, agency: 3003, brand: 3004, admin: 3005,
};
const port = portMap[portal] || 3001;

export default defineConfig({
  testDir: './e2e',
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    baseURL: `http://localhost:${port}`,
  },
  workers: 1,
  testMatch: [
    new RegExp(`${portal}\\..*\\.spec\\.ts$`),
    ...(portal === 'buyer' ? [/lifecycle\..*\.spec\.ts$/] : []),
  ],
});
