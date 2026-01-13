import { spawn, execFileSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

const PORTS = [8080, 3001, 3002, 3003, 3004, 3005];
const HEALTH_E2E_URL = 'http://127.0.0.1:8080/api/health/e2e';
const AUTH_LOGIN_URL = 'http://127.0.0.1:8080/api/auth/login';
const VERBOSE = String(process.env.STACK_CHECK_VERBOSE || '').toLowerCase() === 'true';
const SKIP_PORT_CLEANUP = String(process.env.STACK_CHECK_SKIP_PORT_CLEANUP || '').toLowerCase() === 'true';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function prefixLines(name, stream, isErr) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const out = `[${name}] ${line}`;
      (isErr ? process.stderr : process.stdout).write(out + '\n');
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) {
      const out = `[${name}] ${buffer}`;
      (isErr ? process.stderr : process.stdout).write(out + '\n');
    }
  });
}

function getListeningPidWindows(port) {
  try {
    const stdout = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($null -ne $c) { $c.OwningProcess }`,
      ],
      { encoding: 'utf8' }
    ).trim();

    const pid = Number.parseInt(stdout, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function killPidTreeWindows(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function cleanupPortsBestEffort() {
  if (!isWindows) return;
  if (SKIP_PORT_CLEANUP) return;
  for (const port of PORTS) {
    const pid = getListeningPidWindows(port);
    if (pid) killPidTreeWindows(pid);
  }
}

async function pollJsonOk(url, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        return { ok: true, status: res.status, json };
      }
      await sleep(750);
      continue;
    } catch {
      await sleep(750);
    }
  }

  return { ok: false, status: 0, json: null };
}

async function verifyAdminLoginBestEffort() {
  const username = String(process.env.ADMIN_SEED_USERNAME || '').trim();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '').trim();

  if (!username || !password) {
    return { attempted: false, ok: true };
  }

  try {
    const res = await fetch(AUTH_LOGIN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        // ignore
      }
      return { attempted: true, ok: false, status: res.status, detail: text.slice(0, 500) };
    }

    const json = await res.json();
    const access = json?.tokens?.accessToken;
    if (typeof access !== 'string' || access.length < 20) {
      return { attempted: true, ok: false, status: res.status, detail: 'Missing tokens.accessToken in response' };
    }

    return { attempted: true, ok: true, status: res.status };
  } catch (err) {
    return { attempted: true, ok: false, status: 0, detail: String(err?.message || err) };
  }
}

async function main() {
  // Proactively stop anything stale so checks are deterministic.
  if (isWindows) cleanupPortsBestEffort();

  const child = spawn(process.execPath, ['scripts/dev-all.mjs', '--force'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  // By default we keep output quiet to avoid noisy CI/terminal issues.
  // Opt-in: set STACK_CHECK_VERBOSE=true.
  if (VERBOSE) {
    if (child.stdout) prefixLines('stack', child.stdout, false);
    if (child.stderr) prefixLines('stack', child.stderr, true);
  }

  const result = await pollJsonOk(HEALTH_E2E_URL, 120_000);

  // Always shut down the stack after the check.
  try {
    if (isWindows) {
      cleanupPortsBestEffort();
    } else {
      child.kill('SIGINT');
    }
  } catch {
    // ignore
  }

  if (!result.ok) {
    console.error(`\nStack check FAILED: ${HEALTH_E2E_URL} did not become ready within timeout.`);
    process.exitCode = 1;
    return;
  }

  const s = result.json;
  const portals = s?.portals || {};
  const db = s?.database || {};

  const adminLogin = await verifyAdminLoginBestEffort();

  if (adminLogin.attempted && !adminLogin.ok) {
    console.error(
      `\nAdmin login check FAILED: POST /api/auth/login returned ${adminLogin.status}.\n` +
        `Details: ${adminLogin.detail || '<no details>'}`
    );
    process.exitCode = 1;
  }

  const lines = [
    '\nStack check OK:',
    `- Backend readiness: ${s.status ?? 'ok'}`,
    `- Database: ok=${db.ok} readyState=${db.readyState}`,
    `- Portals: buyer=${portals.buyer} mediator=${portals.mediator} agency=${portals.agency} brand=${portals.brand} admin=${portals.admin}`,
    ...(adminLogin.attempted ? [`- Admin login: ${adminLogin.ok ? 'ok' : 'failed'}`] : []),
  ];
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error('Stack check failed with error:', err);
  cleanupPortsBestEffort();
  process.exitCode = 1;
});
