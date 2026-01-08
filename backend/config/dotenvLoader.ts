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
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
