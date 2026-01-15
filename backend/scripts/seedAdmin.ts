import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

async function runSeedAdmin() {
  const mod = await import('../seeds/admin.js');
  if (typeof (mod as any).seedAdminOnly !== 'function') {
    throw new Error('Missing export seedAdminOnly in ../seeds/admin.js');
  }

  const mobile = process.env.ADMIN_SEED_MOBILE;
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name = process.env.ADMIN_SEED_NAME;

  await (mod as any).seedAdminOnly({ mobile, username, password, name, forcePassword: true, forceUsername: true });
}

async function main() {
  const env = loadEnv();
  await connectMongo(env);
  await runSeedAdmin();

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
    await disconnectMongo();
  });
