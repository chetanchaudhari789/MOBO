import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**', '**/coverage/**'],
    environment: 'node',
    // Tests share a singleton mongoose connection + in-memory mongod instance.
    // Keep a single worker and disable isolation to avoid start/stop races.
    maxWorkers: 1,
    isolate: false,
    // mongodb-memory-server may download a MongoDB binary on first run.
    // On Windows/CI this can exceed 60s.
    hookTimeout: 600_000,
    testTimeout: 120_000,
  },
});
