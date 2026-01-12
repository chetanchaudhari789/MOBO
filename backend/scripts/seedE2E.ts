import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
<<<<<<< HEAD

async function runSeedE2E() {
  const mod = await import('../seeds/e2e.js');
  if (typeof (mod as any).seedE2E !== 'function') {
    throw new Error('Missing export seedE2E in ../seeds/e2e.js');
  }
  await (mod as any).seedE2E();
}
=======
import { seedE2E } from '../seeds/e2e.js';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

async function main() {
  const env = loadEnv();
  await connectMongo(env);
<<<<<<< HEAD
  await runSeedE2E();
=======
  await seedE2E();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
