import { loadDotenv } from './config/dotenvLoader.js';

loadDotenv();
import { loadEnv, type Env } from './config/env.js';
import { connectPrisma, disconnectPrisma, isPrismaAvailable } from './database/prisma.js';
import { createApp } from './app.js';
import type { Server } from 'node:http';
import { startupLog, seedLog, logEvent, getSystemMetrics } from './config/logger.js';

let server: Server | null = null;
let shuttingDown = false;
const shutdownTimeoutMs = 30_000;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  startupLog.info(`Received ${signal}. Shutting down...`);

  const forceTimer = setTimeout(() => {
    startupLog.error('Force shutdown after timeout');
    process.exit(1);
  }, shutdownTimeoutMs);
  forceTimer.unref();

  try {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  } catch (err) {
    startupLog.error('Error while closing HTTP server', { error: err });
  }

  try {
    await disconnectPrisma();
  } catch (err) {
    startupLog.error('Error while disconnecting Prisma', { error: err });
  } finally {
    clearTimeout(forceTimer);
  }
}

async function tryRunE2ESeed() {
  try {
    const mod = await import('./seeds/e2e.js');
    if (typeof (mod as any).seedE2E === 'function') {
      await (mod as any).seedE2E();
    }
  } catch (err) {
    seedLog.warn('SEED_E2E seed failed; skipping', { error: err });
  }
}

async function tryRunAdminSeed(env: Env) {
  try {
    const mod = await import('./seeds/admin.js');
    if (typeof (mod as any).seedAdminOnly === 'function') {
      await (mod as any).seedAdminOnly({
        mobile: env.ADMIN_SEED_MOBILE,
        username: env.ADMIN_SEED_USERNAME,
        password: env.ADMIN_SEED_PASSWORD,
        name: env.ADMIN_SEED_NAME,
      });
    }
  } catch {
    seedLog.warn('SEED_ADMIN requested but seed module is missing (./seeds/admin.js); skipping');
  }
}

async function tryRunDevSeed() {
  try {
    const mod = await import('./seeds/dev.js');
    if (typeof (mod as any).seedDev === 'function') {
      await (mod as any).seedDev();
    }
  } catch (err) {
    seedLog.warn('SEED_DEV seed failed; skipping', { error: err });
  }
}

async function main() {
  const env = loadEnv();

  // Connect PostgreSQL (Prisma) — PRIMARY and ONLY database.
  await connectPrisma();

  if (!isPrismaAvailable()) {
    startupLog.error('PostgreSQL connection failed. Cannot start without primary database.');
    process.exit(1);
  }

  startupLog.info('PostgreSQL connected — primary database ready');

  const seedAdminRequested = env.SEED_ADMIN;
  const seedE2ERequested = env.SEED_E2E;
  const seedDevRequested = env.SEED_DEV;
  const isProd = env.NODE_ENV === 'production';

  // E2E/admin seeding is idempotent and explicitly opt-in.
  // Allow it even when NODE_ENV=production so Playwright (and similar harnesses) work
  // in environments that default NODE_ENV to production.
  if (!isProd || seedAdminRequested || seedE2ERequested) {
    if (seedDevRequested) {
      if (isProd) {
        throw new Error('SEED_DEV is not allowed in production');
      }
      await tryRunDevSeed();
    }
    if (seedAdminRequested) await tryRunAdminSeed(env);
    if (seedE2ERequested) await tryRunE2ESeed();
  }

  const app = createApp(env);

  server = app.listen(env.PORT, () => {
    const metrics = getSystemMetrics();
    logEvent('info', `Backend listening on :${env.PORT}`, {
      domain: 'system',
      eventName: 'APPLICATION_STARTED',
      metadata: {
        nodeEnv: env.NODE_ENV,
        port: env.PORT,
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        ...metrics,
      },
    });
  });
}

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
main().catch((err) => {
  logEvent('error', `Fatal startup error: ${err.message}`, {
    domain: 'system',
    eventName: 'STARTUP_FATAL',
    stack: err instanceof Error ? err.stack : undefined,
    metadata: { ...getSystemMetrics() },
  });
  process.exitCode = 1;
});
