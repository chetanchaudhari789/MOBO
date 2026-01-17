import { loadDotenv } from './config/dotenvLoader.js';

loadDotenv();
import { loadEnv } from './config/env.js';
import { connectMongo, disconnectMongo } from './database/mongo.js';
import { createApp } from './app.js';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';

const require = createRequire(import.meta.url);

let server: Server | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  // eslint-disable-next-line no-console
  console.log(`Received ${signal}. Shutting down...`);

  const forceTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error('Force shutdown after timeout');
    process.exit(1);
  }, 30_000);
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

async function tryRunAdminSeed() {
  try {
    const mod = await import('./seeds/admin.js');
    if (typeof (mod as any).seedAdminOnly === 'function') {
      await (mod as any).seedAdminOnly({
        mobile: process.env.ADMIN_SEED_MOBILE,
        username: process.env.ADMIN_SEED_USERNAME,
        password: process.env.ADMIN_SEED_PASSWORD,
        name: process.env.ADMIN_SEED_NAME,
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

async function tryRunLargeSeed(wipe: boolean) {
  try {
    // Optional module; do not require it at build-time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('./seeds/seed.js');
    if (typeof (mod as any)?.runLargeSeed === 'function') await (mod as any).runLargeSeed({ wipe });
  } catch {
    // eslint-disable-next-line no-console
    console.warn('SEED_LARGE requested but seed module is missing (./seeds/seed.js); skipping');
  }
}

async function main() {
  const env = loadEnv();

  await connectMongo(env);

  const seedAdminRequested = env.SEED_ADMIN || process.env.SEED_ADMIN === 'true';
  const seedE2ERequested = env.SEED_E2E || process.env.SEED_E2E === 'true';
  const seedDevRequested = env.SEED_DEV || process.env.SEED_DEV === 'true';
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
    if (seedAdminRequested) await tryRunAdminSeed();
    if (seedE2ERequested) await tryRunE2ESeed();
    if (!isProd && process.env.SEED_LARGE === 'true') {
      await tryRunLargeSeed(process.env.SEED_WIPE === 'true');
    }
  }

  const app = createApp(env);

  server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on :${env.PORT}`);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exitCode = 1;
});
