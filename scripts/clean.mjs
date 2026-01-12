import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-platform cleanup of generated artifacts.
 *
 * Usage:
 *   node scripts/clean.mjs              # all scopes
 *   node scripts/clean.mjs root         # only repo-root artifacts
 *   node scripts/clean.mjs backend      # only backend artifacts
 *   node scripts/clean.mjs apps         # only Next.js app artifacts
 */

const ROOT = process.cwd();
const scope = (process.argv[2] || 'all').toLowerCase();

function uniq(items) {
  return Array.from(new Set(items));
}

function rmTargets(targets) {
  return uniq(targets).map(async (relativeOrAbsolute) => {
    const abs = path.isAbsolute(relativeOrAbsolute)
      ? relativeOrAbsolute
      : path.join(ROOT, relativeOrAbsolute);

    try {
      await fs.rm(abs, { recursive: true, force: true });
      console.log(`removed: ${path.relative(ROOT, abs) || '.'}`);
    } catch (e) {
      console.warn(`skip: ${path.relative(ROOT, abs) || '.'} (${e?.message || e})`);
    }
  });
}

const rootTargets = ['.cache', 'test-results', 'playwright-report', 'playwright-results.json'];

const backendTargets = ['backend/.cache', 'backend/dist', 'backend/coverage', 'backend/.eslintcache'];

const appNames = ['buyer-app', 'mediator-app', 'agency-web', 'brand-web', 'admin-web'];
const appTargets = appNames.flatMap((name) => [
  `apps/${name}/.next`,
  `apps/${name}/out`,
  `apps/${name}/.turbo`,
  `apps/${name}/.eslintcache`,
]);

const allTargets = [...rootTargets, ...backendTargets, ...appTargets];

let targets;
switch (scope) {
  case 'root':
    targets = rootTargets;
    break;
  case 'backend':
    targets = backendTargets;
    break;
  case 'apps':
  case 'app':
    targets = appTargets;
    break;
  case 'all':
  default:
    targets = allTargets;
    break;
}

await Promise.allSettled(rmTargets(targets));
