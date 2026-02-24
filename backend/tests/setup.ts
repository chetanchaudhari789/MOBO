/**
 * Vitest setup file: connects Prisma (PostgreSQL) before all tests.
 * Spins up an in-memory PostgreSQL database via testcontainers dynamically.
 *
 * Uses extra retries (5) since MongoMemoryServer may be starting
 * concurrently, causing resource contention on the first attempt.
 */
import { beforeAll, afterAll } from 'vitest';
import { connectPrisma, disconnectPrisma, isPrismaAvailable } from '../database/prisma.js';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';

let pgContainer: StartedPostgreSqlContainer | null = null;

beforeAll(async () => {
  // Start the PostgreSQL container with a tmpfs (RAM disk) for in-memory execution
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();

  // Override the connection string with the dynamically assigned port
  process.env.DATABASE_URL = pgContainer.getConnectionUri();

  // Push the schema to the fresh database
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });

  await connectPrisma(5);
  if (!isPrismaAvailable()) {
    // Write directly to stderr so the message shows even when Winston is silent.
    process.stderr.write(
      '\n⚠  [test setup] PostgreSQL not available after 5 retries – PG-dependent tests will fail.\n\n'
    );
  }
}, 30000); // 30s timeout to allow Docker image to pull if not present

afterAll(async () => {
  await disconnectPrisma();
  if (pgContainer) {
    await pgContainer.stop();
  }
});
