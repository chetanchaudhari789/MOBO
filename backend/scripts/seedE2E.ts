import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { connectPrisma, disconnectPrisma } from '../database/prisma.js';
import { seedE2E } from '../seeds/e2e.js';

async function main() {
  await connectPrisma();
  await seedE2E();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
