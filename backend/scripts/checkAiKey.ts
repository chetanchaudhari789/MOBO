import 'dotenv/config';

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { checkGeminiApiKey } from '../services/aiService.js';

async function main() {
  const env = loadEnv();

  // Mongo is required for normal backend startup; keep consistent.
  // If you want to check AI without DB, we can adjust later.
  await connectMongo(env);

  const result = await checkGeminiApiKey(env);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  await disconnectMongo();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('AI key check failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
