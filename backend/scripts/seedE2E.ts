import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

async function runSeedE2E() {
  const mod = await import('../seeds/e2e.js');
  if (typeof (mod as any).seedE2E !== 'function') {
    throw new Error('Missing export seedE2E in ../seeds/e2e.js');
  }
  await (mod as any).seedE2E();
}

async function main() {
  const env = loadEnv();
  await connectMongo(env);
  await runSeedE2E();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
