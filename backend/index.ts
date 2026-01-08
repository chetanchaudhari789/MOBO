import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { connectMongo } from './database/mongo.js';
import { createApp } from './app.js';
import { seedE2E } from './seeds/e2e.js';
import { runLargeSeed } from './seeds/seed.js';

async function main() {
  const env = loadEnv();

  await connectMongo(env);

  if (env.NODE_ENV !== 'production') {
    if (process.env.SEED_E2E === 'true') {
      await seedE2E();
    }
    if (process.env.SEED_LARGE === 'true') {
      await runLargeSeed({
        wipe: process.env.SEED_WIPE === 'true',
      });
    }
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
