import 'dotenv/config';

import { loadEnv } from '../config/env.js';
import { connectPrisma, disconnectPrisma } from '../database/prisma.js';
import { checkGeminiApiKey } from '../services/aiService.js';

async function main() {
  const env = loadEnv();

  await connectPrisma();

  const result = await checkGeminiApiKey(env);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  await disconnectPrisma();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('AI key check failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
