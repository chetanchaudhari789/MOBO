import 'dotenv/config';

// E2E must never use a developer's real DB or API keys.
process.env.MONGODB_URI = '<REPLACE_ME>';
process.env.GEMINI_API_KEY = '';

import { loadEnv } from './config/env.js';
import { connectMongo } from './database/mongo.js';
import { createApp } from './app.js';
import { seedE2E } from './seeds/e2e.js';

async function main() {
  const env = loadEnv();

  await connectMongo(env);

  // Safe, idempotent local seed for automated E2E flows.
  if (env.NODE_ENV !== 'production') {
    await seedE2E();
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
