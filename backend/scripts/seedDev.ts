import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedDev, DEV_ACCOUNTS } from '../seeds/dev.js';

async function main() {
  const env = loadEnv();
  await connectMongo(env);

  const seeded = await seedDev();

  // eslint-disable-next-line no-console
  console.log('Seeded DEV accounts (password default: ChangeMe_123!):');
  // eslint-disable-next-line no-console
  console.log({
    admin: { username: DEV_ACCOUNTS.admin.username, mobile: DEV_ACCOUNTS.admin.mobile },
    agency: { mobile: DEV_ACCOUNTS.agency.mobile, agencyCode: DEV_ACCOUNTS.agency.agencyCode },
    mediator: { mobile: DEV_ACCOUNTS.mediator.mobile, mediatorCode: DEV_ACCOUNTS.mediator.mediatorCode },
    brand: { mobile: DEV_ACCOUNTS.brand.mobile, brandCode: DEV_ACCOUNTS.brand.brandCode },
    shopper: { mobile: DEV_ACCOUNTS.shopper.mobile },
    campaignId: String((seeded.campaign as any)._id),
    dealId: String((seeded.deal as any)._id),
  });
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await disconnectMongo();
    } catch {
      // ignore
    }
  });
