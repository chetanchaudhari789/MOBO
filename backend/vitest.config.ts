import { defineConfig } from 'vitest/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// On Windows, mongodb-memory-server uses the OS temp directory for downloads and DB files.
// If the system drive is low on space, mongod can crash (fassert) or downloads can fail (ENOSPC).
// Point these to a workspace cache directory instead.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

if (process.platform === 'win32') {
  const cacheDir = path.resolve(rootDir, '../.cache/mongodb-memory-server');
  fs.mkdirSync(cacheDir, { recursive: true });

  process.env.MONGOMS_DOWNLOAD_DIR = cacheDir;
  process.env.TMP = cacheDir;
  process.env.TEMP = cacheDir;
}

export default defineConfig({
  root: rootDir,
  // Forks are more reliable than threads for ESM + MongoMemoryServer in CI/Windows.
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**', '**/coverage/**'],
    environment: 'node',
    globals: true,
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
