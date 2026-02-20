/**
 * Prisma client singleton for the MOBO backend.
 *
 * Usage:
 *   import { prisma } from '../database/prisma.js';
 *
 * The client is lazily initialised on first access or by calling `connectPrisma()`.
 * In tests it is skipped when DATABASE_URL is not configured.
 *
 * Uses standard PostgreSQL with connection pooling via @prisma/adapter-pg.
 * Supports SSL/TLS when sslmode=require is set in DATABASE_URL.
 */
import { PrismaClient } from '../generated/prisma/client.js';
import type { TlsOptions } from 'node:tls';

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
 * Parse DATABASE_URL and build a clean pg Pool config with SSL support.
 * 
 * Handles:
 * - sslmode=require / prefer / allow → ssl: { rejectUnauthorized: false }
 * - sslmode=verify-ca / verify-full → ssl: { rejectUnauthorized: true }
 * - channel_binding (libpq-only) → stripped from connection string
 * - currentSchema / schema → extracted for PrismaPg adapter
 * - Strips non-standard params that the pg driver doesn't understand
 *
 * Note: sslmode=prefer / allow have "try non-SSL first" semantics in libpq, but
 * node-postgres does not implement that fallback. These modes are treated the same
 * as `require` (TLS always on, certificate not verified).
 */
function buildPoolConfig(url: string) {
  const parsedUrl = new URL(url);

  // Extract PostgreSQL schema name (supports both ?schema= and ?currentSchema=)
  const pgSchema =
    parsedUrl.searchParams.get('currentSchema') ||
    parsedUrl.searchParams.get('schema') ||
    undefined;

  // Determine SSL mode from URL params
  const sslmode = parsedUrl.searchParams.get('sslmode') || 'disable';
  const requireSsl = ['require', 'verify-ca', 'verify-full'].includes(sslmode);
  const preferSsl = ['prefer', 'allow'].includes(sslmode);

  // Build SSL config for the pg driver
  let ssl: boolean | TlsOptions | undefined;
  if (requireSsl) {
    ssl = {
      rejectUnauthorized: ['verify-ca', 'verify-full'].includes(sslmode),
      // For sslmode=require, we enforce encrypted transport but allow
      // self-signed or CA-signed certs on managed hosting (Neon, Render, etc.)
    };
  } else if (preferSsl) {
    ssl = { rejectUnauthorized: false };
  }
  // When sslmode=disable or not set, ssl remains undefined (no TLS).

  // Strip params that pg Pool doesn't understand — pass only standard libpq params.
  // The pg driver handles: host, port, database, user, password, ssl, application_name, etc.
  // It does NOT handle: sslmode, currentSchema, schema, channel_binding (these are libpq-only).
  const paramsToStrip = ['sslmode', 'currentSchema', 'schema', 'channel_binding'];
  for (const p of paramsToStrip) {
    parsedUrl.searchParams.delete(p);
  }
  const cleanUrl = parsedUrl.toString();

  const poolConfig: Record<string, unknown> = {
    connectionString: cleanUrl,
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || '5000', 10),
  };

  if (ssl) {
    poolConfig.ssl = ssl;
  }

  return { poolConfig, pgSchema, sslmode };
}

/**
 * Connect to PostgreSQL via Prisma with connection pooling.
 * Safe to call multiple times.
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
      const logConfig: ('warn' | 'error')[] =
        process.env.NODE_ENV === 'development'
          ? ['warn', 'error']
          : ['error'];

      // Standard PostgreSQL with connection pooling + SSL
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const { poolConfig, pgSchema, sslmode } = buildPoolConfig(url);
      const adapter = new PrismaPg(poolConfig as any, pgSchema ? { schema: pgSchema } : undefined);
      const client = new PrismaClient({ adapter, log: logConfig });

      const sslLabel = sslmode === 'disable' ? 'off' : sslmode;
      console.log(`[prisma] Using PostgreSQL adapter (pool max=${poolConfig.max}, schema=${pgSchema ?? 'public'}, ssl=${sslLabel})`);

      // Run a lightweight query to verify connectivity upfront.
      await client.$queryRaw`SELECT 1`;
      _prisma = client;
      console.log(`[prisma] Connected to PostgreSQL (SSL ${sslLabel})`);
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
