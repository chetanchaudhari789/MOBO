import type { PlaywrightTestConfig } from '@playwright/test';

const nodeOptions = [process.env.NODE_OPTIONS, '--no-deprecation'].filter(Boolean).join(' ');

const config: PlaywrightTestConfig = {
  testDir: './e2e',
  testMatch: /.*\.(spec|test)\.(js|ts|mjs)$/,
  reporter: 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
  },

  projects: [
    {
      name: 'buyer',
      use: { baseURL: 'http://localhost:3001' },
      testMatch: ['buyer.*.spec.ts'],
    },
    {
      name: 'api',
      use: { baseURL: 'http://localhost:3001' },
      testMatch: ['**/*.api.spec.ts'],
    },
    {
      name: 'mediator',
      use: { baseURL: 'http://localhost:3002' },
      testMatch: ['mediator.*.spec.ts'],
    },
    {
      name: 'agency',
      use: { baseURL: 'http://localhost:3003' },
      testMatch: ['agency.*.spec.ts'],
    },
    {
      name: 'brand',
      use: { baseURL: 'http://localhost:3004' },
      testMatch: ['brand.*.spec.ts'],
    },
    {
      name: 'admin',
      use: { baseURL: 'http://localhost:3005' },
      testMatch: ['admin.*.spec.ts'],
    },
  ],

  // Start the safe E2E backend (in-memory DB, seeded accounts) and the buyer app.
  // E2E backend: never uses real DB/API keys.
  webServer: [
    {
      command: 'npm --prefix backend run dev:e2e',
      url: 'http://localhost:8080/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      command: 'npm --prefix apps/buyer-app run dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      command: 'npm --prefix apps/mediator-app run dev',
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      command: 'npm --prefix apps/agency-web run dev',
      url: 'http://localhost:3003',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      command: 'npm --prefix apps/brand-web run dev',
      url: 'http://localhost:3004',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
    {
      command: 'npm --prefix apps/admin-web run dev',
      url: 'http://localhost:3005',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_OPTIONS: nodeOptions,
      },
    },
  ],
};

export default config;
