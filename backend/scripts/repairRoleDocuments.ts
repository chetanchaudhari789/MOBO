import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { UserModel } from '../models/User.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';

async function main() {
  const env = loadEnv();
  await connectMongo(env);

  const cursor = UserModel.find({ deletedAt: null }).cursor();

  let processed = 0;
  let repaired = 0;
  let failed = 0;

  for await (const user of cursor) {
    processed += 1;
    try {
      const roles = Array.isArray((user as any).roles) ? (user as any).roles : [];
      if (!roles.length) continue;
      if (!roles.some((r: string) => ['agency', 'brand', 'mediator', 'shopper'].includes(r))) continue;

      await ensureRoleDocumentsForUser({ user });
      repaired += 1;
    } catch (err) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn('Failed to repair role docs for user', String((user as any)?._id ?? ''), err);
    }
  }

  // eslint-disable-next-line no-console
  console.log('✅ Role-document repair complete');
  // eslint-disable-next-line no-console
  console.log({ processed, repaired, failed });
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
