import 'dotenv/config';

import { MongoMemoryReplSet } from 'mongodb-memory-server';

// E2E must never use a developer's real DB or API keys.
process.env.GEMINI_API_KEY = '';

// Force a safe runtime mode for E2E.
// Some developer machines set NODE_ENV=production in .env; that would otherwise skip E2E seeding
// and cause Playwright readiness checks to time out.
process.env.NODE_ENV = 'test';

import { loadEnv } from './config/env.js';
import { connectMongo } from './database/mongo.js';
import { createApp } from './app.js';

async function tryRunE2ESeed() {
  try {
    // In E2E we run under tsx (TypeScript); import the TS module directly.
    const mod = await import('./seeds/e2e.ts');
    if (typeof (mod as any).seedE2E === 'function') {
      await (mod as any).seedE2E();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('E2E seed module failed to load/run (./seeds/e2e.ts); skipping', err);
  }
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ dbName: 'mobo_e2e' }],
  });

  process.env.MONGODB_URI = replSet.getUri();
  process.env.MONGODB_DBNAME = 'mobo_e2e';

  const shutdown = async () => {
    try {
      await replSet.stop();
    } catch {
      // ignore
    }
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  const env = loadEnv();

  await connectMongo(env);

  // Safe, idempotent local seed for automated E2E flows.
  if (env.NODE_ENV !== 'production') {
    await tryRunE2ESeed();
  }

  const app = createApp(env);

  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exitCode = 1;
});
