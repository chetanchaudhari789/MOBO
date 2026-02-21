/**
 * Vitest setup file: connects Prisma (PostgreSQL) before all tests.
 * DATABASE_URL is loaded from .env via dotenv in vitest.config.ts.
 */
import { beforeAll, afterAll } from 'vitest';
import { connectPrisma, disconnectPrisma } from '../database/prisma.js';

beforeAll(async () => {
  await connectPrisma();
});

afterAll(async () => {
  await disconnectPrisma();
});
