import { spawn } from 'node:child_process';
import net from 'node:net';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? process.execPath : 'npm';
const npmCli = isWindows
  ? 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  : null;

const smokeMode = process.argv.includes('--smoke');

const services = [
  {
    name: 'backend',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'backend', 'run', 'dev'],
    port: 8080,
  },
  {
    name: 'buyer',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/buyer-app', 'run', 'dev'],
    port: 3001,
  },
  {
    name: 'mediator',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/mediator-app', 'run', 'dev'],
    port: 3002,
  },
  {
    name: 'agency',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/agency-web', 'run', 'dev'],
    port: 3003,
  },
  {
    name: 'brand',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/brand-web', 'run', 'dev'],
    port: 3004,
  },
  {
    name: 'admin',
    cwd: process.cwd(),
    cmd: npmCmd,
    args: ['--prefix', 'apps/admin-web', 'run', 'dev'],
    port: 3005,
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

async function startAll() {
  for (const svc of services) {
    if (typeof svc.port === 'number') {
      const alreadyRunning = await isPortOpen(svc.port);
      if (alreadyRunning) {
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
}
