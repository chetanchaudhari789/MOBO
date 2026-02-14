import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

function tryLoad(filePath: string) {
  if (!filePath) return;
  if (!fs.existsSync(filePath)) return;
  dotenv.config({ path: filePath, override: false });
}

export function loadDotenv() {
  // When running from dist/ (e.g. `node dist/index.js`), import.meta.url points
  // to dist/config/dotenvLoader.js → `..` resolves to dist/ rather than backend/.
  // Detect this and adjust so .env files are always found at the real backend root.
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.resolve(thisDir, '..');
  const grandParentDir = path.resolve(parentDir, '..');
  const isRunningFromDist =
    path.basename(parentDir) === 'config' &&
    path.basename(grandParentDir) === 'dist';
  const backendDir = isRunningFromDist
    ? path.resolve(grandParentDir, '..')  // dist/config/.. → dist → dist/.. → backend/
    : parentDir;                      // config/.. → backend/
  const repoRoot = path.resolve(backendDir, '..');

  // Respect explicit override if provided.
  const explicit = process.env.DOTENV_CONFIG_PATH;
  if (explicit) {
    tryLoad(explicit);
    return;
  }

  // Prefer backend-local env so workspace root env doesn't accidentally leak.
  tryLoad(path.join(backendDir, '.env'));
  tryLoad(path.join(backendDir, '.env.local'));

  // Fallbacks (some setups keep env at repo root).
  tryLoad(path.join(repoRoot, '.env'));
  tryLoad(path.join(repoRoot, '.env.local'));
}
