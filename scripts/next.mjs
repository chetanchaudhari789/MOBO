#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , subcommand, ...args] = process.argv;

if (!subcommand) {
  console.error('Usage: node scripts/next.mjs <dev|build|start> [args...]');
  process.exit(2);
}

// Next 15.5.x may try to patch npm lockfiles to add missing optional SWC entries.
// In workspace setups this can fail (Next performs network fetches), breaking dev/build/start.
// We already install the platform SWC package for this OS, so skip the patcher.
process.env.NEXT_IGNORE_INCORRECT_LOCKFILE = '1';

// Next.js warns (and can misbehave) if users set a non-standard NODE_ENV.
// Force a safe value for production-only commands.
if (subcommand === 'build' || subcommand === 'start') {
  process.env.NODE_ENV = 'production';
}

const packageJsonPath = process.env.npm_package_json;
const packageDir = packageJsonPath ? dirname(packageJsonPath) : process.cwd();

function findNextCli(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', 'next', 'dist', 'bin', 'next');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const nextCli = findNextCli(packageDir);

let result;
if (nextCli) {
  // Run Next via node to avoid platform-specific shims.
  result = spawnSync(process.execPath, [nextCli, subcommand, ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: packageDir,
    shell: false,
  });
} else {
  // Fallback: try npx.
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  result = spawnSync(command, ['next', subcommand, ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: packageDir,
    shell: false,
  });
}

if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = typeof result.status === 'number' ? result.status : 1;
}
