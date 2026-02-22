import 'dotenv/config';

import { MongoMemoryReplSet } from 'mongodb-memory-server';

// E2E must never use a developer's real DB or API keys.
process.env.GEMINI_API_KEY = '';

// Ensure readiness checks validate seeded accounts.
process.env.SEED_E2E = 'true';

// Force a safe runtime mode for E2E.
// Some developer machines set NODE_ENV=production in .env; that would otherwise skip E2E seeding
// and cause Playwright readiness checks to time out.
process.env.NODE_ENV = 'test';

import { loadEnv } from './config/env.js';
import { connectMongo } from './database/mongo.js';
import { createApp } from './app.js';
import { startupLog } from './config/logger.js';

async function tryRunE2ESeed() {
  // In E2E we run under tsx (TypeScript); import the TS module directly.
  const mod = await import('./seeds/e2e.ts');
  if (typeof (mod as any).seedE2E !== 'function') {
    throw new Error('Missing export seedE2E in ./seeds/e2e.ts');
  }
  await (mod as any).seedE2E();
}

async function main() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 60_000 }],
  });

  process.env.MONGODB_URI = replSet.getUri('mobo_e2e');
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
    startupLog.info(`Backend listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  startupLog.error('Fatal startup error', { error: err });
  process.exitCode = 1;
});
