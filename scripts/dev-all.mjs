import { spawn } from 'node:child_process';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? process.execPath : 'npm';
const npmCli = isWindows
  ? 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  : null;

const smokeMode = process.argv.includes('--smoke');
const forceMode = process.argv.includes('--force');

const services = [
  {
    name: 'backend',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'backend', 'run', process.env.SEED_E2E === 'true' ? 'dev:e2e' : 'dev'],
    port: 8080,
  },
  {
    name: 'buyer',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/buyer-app', 'run', 'dev'],
    port: 3001,
    healthUrl: 'http://127.0.0.1:3001/_next/static/chunks/main-app.js',
  },
  {
    name: 'mediator',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/mediator-app', 'run', 'dev'],
    port: 3002,
    healthUrl: 'http://127.0.0.1:3002/_next/static/chunks/main-app.js',
  },
  {
    name: 'agency',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/agency-web', 'run', 'dev'],
    port: 3003,
    healthUrl: 'http://127.0.0.1:3003/_next/static/chunks/main-app.js',
  },
  {
    name: 'brand',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/brand-web', 'run', 'dev'],
    port: 3004,
    healthUrl: 'http://127.0.0.1:3004/_next/static/chunks/main-app.js',
  },
  {
    name: 'admin',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/admin-web', 'run', 'dev'],
    port: 3005,
    healthUrl: 'http://127.0.0.1:3005/_next/static/chunks/main-app.js',
  },
];

/**
 * Simple multi-process launcher.
 *
 * - Uses each package's existing `dev` script and ports.
 * - Output is prefixed with the service name.
 * - Ctrl+C stops all child processes.
 */

const children = new Map();

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

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net
      .connect({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      })
      .on('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isHttpOk(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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
        `$c = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq ${port} } | Select-Object -First 1; if ($null -ne $c) { $c.OwningProcess }`,
      ],
      { encoding: 'utf8' }
    ).trim();

    const pid = Number.parseInt(stdout, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function getListeningPidWindowsNetstat(port) {
  try {
    const stdout = execFileSync(
      'cmd',
      [
        '/d',
        '/c',
        // Match both IPv4 and IPv6 listeners.
        `netstat -ano -p TCP | findstr /R /C:":${port} .*LISTENING"`,
      ],
      { encoding: 'utf8' }
    ).trim();

    if (!stdout) return null;

    // netstat output example:
    // TCP    0.0.0.0:3002           0.0.0.0:0              LISTENING       1234
    // TCP    [::]:3002              [::]:0                 LISTENING       1234
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const last = lines[0];
    const parts = last.split(/\s+/);
    const pidStr = parts[parts.length - 1];
    const pid = Number.parseInt(pidStr, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function killPidTreeWindows(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureServiceNotStale(svc) {
  if (typeof svc.port !== 'number') return;

  const isOpen = await isPortOpen(svc.port);
  if (!isOpen) return;

  const shouldCheckHealth = typeof svc.healthUrl === 'string' && svc.healthUrl.length > 0;
  const healthy = shouldCheckHealth ? await isHttpOk(svc.healthUrl) : true;

  if (!forceMode && healthy) return;

  if (!isWindows) {
    process.stdout.write(
      `[${svc.name}] already listening on ${svc.port} but cannot auto-restart on this OS; proceeding without killing\n`
    );
    return;
  }

  const pid = getListeningPidWindows(svc.port) ?? getListeningPidWindowsNetstat(svc.port);
  if (!pid) {
    process.stdout.write(
      `[${svc.name}] already listening on ${svc.port} but PID lookup failed; proceeding without killing\n`
    );
    return;
  }

  const reason = forceMode ? 'force restart requested' : 'health check failed';
  process.stdout.write(`[${svc.name}] port ${svc.port} in use (pid ${pid}); ${reason}; killing\n`);
  killPidTreeWindows(pid);

  // Wait briefly for the port to actually free.
  for (let i = 0; i < 20; i += 1) {
    const stillOpen = await isPortOpen(svc.port);
    if (!stillOpen) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function startAll() {
  for (const svc of services) {
    await ensureServiceNotStale(svc);

    if (typeof svc.port === 'number') {
      const alreadyRunning = await isPortOpen(svc.port);
      if (alreadyRunning) {
        // If we reach here, either we are not in --force mode and health check passed,
        // or we were unable to auto-kill the existing listener.
        process.stdout.write(`[${svc.name}] already listening on ${svc.port}; skipping\n`);
        continue;
      }
    }

    const cmd = isWindows ? npmCmd : svc.cmd;
    const args = isWindows ? [npmCli, ...svc.args] : svc.args;

    const child = spawn(cmd, args, {
      cwd: svc.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Optional: keep Node warnings sane for dev too.
        // Users can override with their own NODE_OPTIONS.
        NODE_OPTIONS: process.env.NODE_OPTIONS || '',
      },
    });

    children.set(svc.name, child);

    if (child.stdout) prefixLines(svc.name, child.stdout, false);
    if (child.stderr) prefixLines(svc.name, child.stderr, true);

    child.on('exit', (code, signal) => {
      const msg = `[${svc.name}] exited (${signal ?? code ?? 'unknown'})`;
      process.stderr.write(msg + '\n');
    });
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children.values()) {
    try {
      if (isWindows) {
        // Best-effort; SIGTERM isn't reliable for all Windows child trees.
        child.kill();
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // ignore
    }
  }

  // Give processes a moment to exit; then hard-exit.
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await startAll();

if (smokeMode) {
  // Give children a moment to start; then shut everything down.
  setTimeout(() => shutdown(), 2500);
} else {
  // Keep the parent process alive so child dev servers stay up.
  // Without this, Node can exit after startup, closing stdio pipes and
  // causing children to terminate.
  await new Promise(() => {});
}
