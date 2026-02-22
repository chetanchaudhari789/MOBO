/**
 * Vitest setup file: connects Prisma (PostgreSQL) before all tests.
 * DATABASE_URL is loaded from .env via dotenv in vitest.config.ts.
 *
 * Uses extra retries (5) since MongoMemoryServer may be starting
 * concurrently, causing resource contention on the first attempt.
 */
import { beforeAll, afterAll } from 'vitest';
import { connectPrisma, disconnectPrisma, isPrismaAvailable } from '../database/prisma.js';

beforeAll(async () => {
  await connectPrisma(5);
  if (!isPrismaAvailable()) {
    // Write directly to stderr so the message shows even when Winston is silent.
    process.stderr.write(
      '\n⚠  [test setup] PostgreSQL not available after 5 retries – PG-dependent tests will fail.\n\n'
    );
  }
});

afterAll(async () => {
  await disconnectPrisma();
});
