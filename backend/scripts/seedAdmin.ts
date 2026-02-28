import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { connectPrisma, disconnectPrisma } from '../database/prisma.js';
import { seedAdminOnly } from '../seeds/admin.js';

async function main() {
  await connectPrisma();

  const mobile = process.env.ADMIN_SEED_MOBILE;
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name = process.env.ADMIN_SEED_NAME;

  await seedAdminOnly({ mobile, username, password, name, forcePassword: true, forceUsername: true });

  // eslint-disable-next-line no-console
  console.log('✅ Admin seed complete');
  // eslint-disable-next-line no-console
  console.log(`Admin username: ${process.env.ADMIN_SEED_USERNAME || 'root'}`);
  // eslint-disable-next-line no-console
  console.log(`Admin mobile: ${process.env.ADMIN_SEED_MOBILE || '9000000000'}`);
  // eslint-disable-next-line no-console
  console.log('Admin password: (set via ADMIN_SEED_PASSWORD)');
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
