/**
 * Prisma client singleton for the MOBO backend.
 *
 * Usage:
 *   import { prisma } from '../database/prisma.js';
 *
 * The client is lazily initialised on first access or by calling `connectPrisma()`.
 * In tests it is skipped when DATABASE_URL is not configured.
 *
 * Uses @prisma/adapter-neon for Prisma v7 driver-adapter approach with Neon
 * serverless driver (WebSocket-based, works in Node and edge runtimes).
 */
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaNeon } from '@prisma/adapter-neon';

let _prisma: PrismaClient | null = null;
let _connecting: Promise<void> | null = null;

/**
 * Whether Prisma/PG is available. Returns false when DATABASE_URL is not set
 * or when the client could not connect.
 */
export function isPrismaAvailable(): boolean {
  return _prisma !== null;
}

/**
 * Return the shared Prisma client instance (or null when PG is unavailable).
 */
export function getPrisma(): PrismaClient | null {
  return _prisma;
}

/**
 * Convenience getter that throws if Prisma is not connected.
 */
export function prisma(): PrismaClient {
  if (!_prisma) throw new Error('Prisma client is not connected. Call connectPrisma() first or check isPrismaAvailable().');
  return _prisma;
}

/**
 * Connect to PostgreSQL via Prisma + Neon adapter. Safe to call multiple times.
 * Returns silently when DATABASE_URL is not configured (PG is optional).
 */
export async function connectPrisma(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[prisma] DATABASE_URL not set – PostgreSQL dual-write disabled');
    return;
  }

  if (_prisma) return;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    try {
      const adapter = new PrismaNeon({ connectionString: url });

      const client = new PrismaClient({
        adapter,
        log:
          process.env.NODE_ENV === 'development'
            ? ['warn', 'error']
            : ['error'],
      });
      // Adapter-based clients are connected on first query; run a lightweight
      // query to verify connectivity upfront.
      await client.$queryRaw`SELECT 1`;
      _prisma = client;
      console.log('[prisma] Connected to PostgreSQL (Neon)');
    } catch (err) {
      console.error('[prisma] Failed to connect to PostgreSQL:', err);
      // Non-fatal — Mongo is still the primary. PG is a shadow.
      _prisma = null;
    } finally {
      _connecting = null;
    }
  })();

  return _connecting;
}

/**
 * Gracefully disconnect the Prisma client (used during shutdown).
 */
export async function disconnectPrisma(): Promise<void> {
  if (_prisma) {
    try {
      await _prisma.$disconnect();
    } catch {
      // best effort
    }
    _prisma = null;
  }
}
