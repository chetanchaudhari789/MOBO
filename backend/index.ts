import { loadDotenv } from './config/dotenvLoader.js';

loadDotenv();
import { loadEnv, type Env } from './config/env.js';
import { connectMongo, disconnectMongo } from './database/mongo.js';
import { createApp } from './app.js';
import type { Server } from 'node:http';

let server: Server | null = null;
let shuttingDown = false;
const shutdownTimeoutMs = 30_000;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  // eslint-disable-next-line no-console
  console.log(`Received ${signal}. Shutting down...`);

  const forceTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error('Force shutdown after timeout');
    process.exit(1);
  }, shutdownTimeoutMs);
  forceTimer.unref();

  try {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error while closing HTTP server:', err);
  }

  try {
    await disconnectMongo();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error while disconnecting Mongo:', err);
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
    // eslint-disable-next-line no-console
    console.warn('SEED_E2E seed failed; skipping', err);
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
    // eslint-disable-next-line no-console
    console.warn('SEED_ADMIN requested but seed module is missing (./seeds/admin.js); skipping');
  }
}

async function tryRunDevSeed() {
  try {
    const mod = await import('./seeds/dev.js');
    if (typeof (mod as any).seedDev === 'function') {
      await (mod as any).seedDev();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('SEED_DEV seed failed; skipping', err);
  }
}

async function main() {
  const env = loadEnv();

  await connectMongo(env);

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
    // eslint-disable-next-line no-console
    console.log(`Backend listening on :${env.PORT}`);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled promise rejection:', reason);
  process.exitCode = 1;
  void shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught exception:', err);
  process.exitCode = 1;
  void shutdown('uncaughtException');
});
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exitCode = 1;
});
