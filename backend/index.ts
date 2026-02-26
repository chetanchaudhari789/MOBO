import { loadDotenv } from './config/dotenvLoader.js';

loadDotenv();
import { loadEnv } from './config/env.js';
import { connectPrisma, disconnectPrisma, isPrismaAvailable } from './database/prisma.js';
import { createApp } from './app.js';
import type { Server } from 'node:http';
import { startupLog, logEvent, getSystemMetrics } from './config/logger.js';
import { setReady, setShuttingDown } from './config/lifecycle.js';

// ── Lifecycle state ──────────────────────────────────────────────────
let server: Server | null = null;
let shuttingDown = false;
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30_000;

// ── In-flight request tracking ───────────────────────────────────────
// Allows graceful shutdown to wait for active requests to complete.
let inFlightRequests = 0;
let drainResolve: (() => void) | null = null;

function onRequestStart() { inFlightRequests++; }
function onRequestEnd() {
  inFlightRequests--;
  if (inFlightRequests <= 0 && drainResolve) drainResolve();
}

function waitForDrain(timeoutMs: number): Promise<void> {
  if (inFlightRequests <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    drainResolve = resolve;
    setTimeout(resolve, timeoutMs);
  });
}

// ── Graceful shutdown ────────────────────────────────────────────────
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  setShuttingDown(true);
  setReady(false); // immediately stop accepting new traffic via health probes

  startupLog.info(`Received ${signal}. Shutting down gracefully…`, {
    inFlightRequests,
    shutdownTimeoutMs,
  });

  const forceTimer = setTimeout(() => {
    startupLog.error('Force shutdown after timeout', { inFlightRequests });
    process.exit(1);
  }, shutdownTimeoutMs);
  forceTimer.unref();

  try {
    // 1. Stop accepting new connections
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });

    // 2. Wait for in-flight requests to drain (up to half the shutdown budget)
    const drainBudget = Math.floor(shutdownTimeoutMs * 0.6);
    if (inFlightRequests > 0) {
      startupLog.info(`Draining ${inFlightRequests} in-flight request(s)…`, { drainBudget });
      await waitForDrain(drainBudget);
    }
  } catch (err) {
    startupLog.error('Error while closing HTTP server', { error: err });
  }

  try {
    await disconnectPrisma();
  } catch (err) {
    startupLog.error('Error while disconnecting Prisma', { error: err });
  } finally {
    clearTimeout(forceTimer);
    startupLog.info('Shutdown complete.');
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();

  // Connect PostgreSQL (Prisma) — PRIMARY and ONLY database.
  await connectPrisma();

  if (!isPrismaAvailable()) {
    startupLog.error('PostgreSQL connection failed. Cannot start without primary database.');
    process.exit(1);
  }

  startupLog.info('PostgreSQL connected — primary database ready');

  const app = createApp(env);

  // Track in-flight requests for graceful draining.
  app.use((req, res, next) => {
    onRequestStart();
    res.on('close', onRequestEnd);
    next();
  });

  server = app.listen(env.PORT, () => {
    // ── Server hardening for reverse proxy (ALB/NGINX/Render) ──
    // Default keepAliveTimeout (5s) is shorter than most LB idle timeouts (60s),
    // causing 502 errors. Set to 65s to outlast them.
    server!.keepAliveTimeout = 65_000;
    server!.headersTimeout = 66_000; // must exceed keepAliveTimeout

    // Mark ready — health probes can now return 200.
    setReady(true);

    const metrics = getSystemMetrics();
    logEvent('info', `Backend listening on :${env.PORT}`, {
      domain: 'system',
      eventName: 'APPLICATION_STARTED',
      metadata: {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
        shutdownTimeoutMs,
        ...metrics,
      },
    });
  });
}

// ── Process event handlers ───────────────────────────────────────────
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logEvent('error', 'Unhandled promise rejection', {
    domain: 'system',
    eventName: 'UNHANDLED_REJECTION',
    stack: reason instanceof Error ? reason.stack : String(reason),
    metadata: { reason: String(reason), ...getSystemMetrics() },
  });
  process.exitCode = 1;
  void shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logEvent('error', `Uncaught exception: ${err.message}`, {
    domain: 'system',
    eventName: 'UNCAUGHT_EXCEPTION',
    errorCode: (err as any).code,
    stack: err.stack,
    metadata: { name: err.name, ...getSystemMetrics() },
  });
  process.exitCode = 1;
  void shutdown('uncaughtException');
});
// Log deprecation warnings in dev/staging so they're caught before production.
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') {
    startupLog.warn(`Node.js deprecation: ${warning.message}`, { code: (warning as any).code });
  }
});
main().catch((err) => {
  logEvent('error', `Fatal startup error: ${err.message}`, {
    domain: 'system',
    eventName: 'STARTUP_FATAL',
    stack: err instanceof Error ? err.stack : undefined,
    metadata: { ...getSystemMetrics() },
  });
  process.exitCode = 1;
});
