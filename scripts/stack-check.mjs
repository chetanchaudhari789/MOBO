import { spawn, execFileSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

const PORTS = [8080, 3001, 3002, 3003, 3004, 3005];
const HEALTH_E2E_URL = 'http://127.0.0.1:8080/api/health/e2e';
const AUTH_LOGIN_URL = 'http://127.0.0.1:8080/api/auth/login';
const AUTH_LOGIN_FALLBACK_URL = 'http://127.0.0.1:3005/api/auth/login';
const REALTIME_STREAM_URL = 'http://127.0.0.1:8080/api/realtime/stream';
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
  const useSeedE2E = String(process.env.SEED_E2E || '').toLowerCase() === 'true';
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  const isNonProd = nodeEnv !== 'production';
  const mongoRaw = String(process.env.MONGODB_URI || '').trim();
  const mongoPlaceholder = !mongoRaw || mongoRaw.includes('REPLACE_ME') || (mongoRaw.startsWith('<') && mongoRaw.endsWith('>'));
  let username = String(process.env.ADMIN_SEED_USERNAME || '').trim();
  let password = String(process.env.ADMIN_SEED_PASSWORD || '').trim();

  if ((!username || !password) && (useSeedE2E || (isNonProd && mongoPlaceholder))) {
    username = 'root';
    password = 'ChangeMe_123!';
  }

  if (!username || !password) return { attempted: false, ok: true, accessToken: null };

  const deadline = Date.now() + 15_000;
  let lastStatus = 0;
  let lastDetail = '';
  const urls = [AUTH_LOGIN_URL, AUTH_LOGIN_FALLBACK_URL];

  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        lastStatus = res.status;

        if (!res.ok) {
          let text = '';
          try {
            text = await res.text();
          } catch {
            // ignore
          }
          lastDetail = text.slice(0, 500);

          if (res.status >= 500 || res.status === 404) {
            continue;
          }
        } else {
          const json = await res.json();
          const access = json?.tokens?.accessToken;
          if (typeof access === 'string' && access.length >= 20) {
            return { attempted: true, ok: true, status: res.status, accessToken: access };
          }
          lastDetail = 'Missing tokens.accessToken in response';
        }
      } catch (err) {
        lastStatus = 0;
        lastDetail = String(err?.message || err);
        continue;
      }
    }

    await sleep(300);
  }

  return { attempted: true, ok: false, status: lastStatus, detail: lastDetail || 'Login timed out', accessToken: null };
}

async function verifyRealtimeSseBestEffort(accessToken) {
  if (!accessToken) return { attempted: false, ok: true };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(REALTIME_STREAM_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'text/event-stream',
      },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { attempted: true, ok: false, status: res.status, detail: text.slice(0, 300) };
    }

    const reader = res.body?.getReader();
    if (!reader) return { attempted: true, ok: false, status: res.status, detail: 'Missing response body reader' };

    const decoder = new TextDecoder('utf-8');
    let buf = '';
    const deadline = Date.now() + 4_000;

    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes('event: ready')) {
        try {
          ctrl.abort();
        } catch {
          // ignore
        }
        return { attempted: true, ok: true, status: res.status };
      }
    }

    return { attempted: true, ok: false, status: res.status, detail: 'Timed out waiting for SSE ready event' };
  } catch (err) {
    if (String(err?.name || '') === 'AbortError') {
      return { attempted: true, ok: true, status: 200 };
    }
    return { attempted: true, ok: false, status: 0, detail: String(err?.message || err) };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  // Proactively stop anything stale so checks are deterministic.
  if (isWindows) cleanupPortsBestEffort();

  const env = { ...process.env };
  if (!env.SEED_E2E) env.SEED_E2E = 'true';

  const child = spawn(process.execPath, ['scripts/dev-all.mjs', '--force'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  // By default we keep output quiet to avoid noisy CI/terminal issues.
  // Opt-in: set STACK_CHECK_VERBOSE=true.
  if (VERBOSE) {
    if (child.stdout) prefixLines('stack', child.stdout, false);
    if (child.stderr) prefixLines('stack', child.stderr, true);
  }

  const result = await pollJsonOk(HEALTH_E2E_URL, 120_000);
  const shutdown = () => {
    try {
      if (isWindows) {
        cleanupPortsBestEffort();
      } else {
        child.kill('SIGINT');
      }
    } catch {
      // ignore
    }
  };

  if (!result.ok) {
    console.error(`\nStack check FAILED: ${HEALTH_E2E_URL} did not become ready within timeout.`);
    process.exitCode = 1;
    shutdown();
    return;
  }

  const s = result.json;
  const portals = s?.portals || {};
  const db = s?.database || {};

  const adminLogin = await verifyAdminLoginBestEffort();
  const realtimeSse = await verifyRealtimeSseBestEffort(adminLogin.accessToken);

  if (adminLogin.attempted && !adminLogin.ok) {
    console.error(
      `\nAdmin login check FAILED: POST /api/auth/login returned ${adminLogin.status}.\n` +
        `Details: ${adminLogin.detail || '<no details>'}`
    );
    process.exitCode = 1;
  }

  if (realtimeSse.attempted && !realtimeSse.ok) {
    console.error(
      `\nRealtime SSE check FAILED: GET /api/realtime/stream did not produce 'ready'.\n` +
        `Status: ${realtimeSse.status}. Details: ${realtimeSse.detail || '<no details>'}`
    );
    process.exitCode = 1;
  }

  const lines = [
    '\nStack check OK:',
    `- Backend readiness: ${s.status ?? 'ok'}`,
    `- Database: ok=${db.ok} readyState=${db.readyState}`,
    `- Portals: buyer=${portals.buyer} mediator=${portals.mediator} agency=${portals.agency} brand=${portals.brand} admin=${portals.admin}`,
    ...(adminLogin.attempted ? [`- Admin login: ${adminLogin.ok ? 'ok' : 'failed'}`] : []),
    ...(realtimeSse.attempted ? [`- Realtime SSE: ${realtimeSse.ok ? 'ok' : 'failed'}`] : []),
  ];
  console.log(lines.join('\n'));
  shutdown();
}

main().catch((err) => {
  console.error('Stack check failed with error:', err);
  cleanupPortsBestEffort();
  process.exitCode = 1;
});
