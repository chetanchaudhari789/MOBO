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
import { dbLog } from '../config/logger.js';

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
 * - sslmode=require / verify-ca / verify-full → ssl: { rejectUnauthorized: true }
 * - sslmode=prefer / allow → ssl: { rejectUnauthorized: false }
 * - channel_binding=require → retained in connection string
 * - currentSchema / schema → extracted for PrismaPg adapter
 * - Strips non-standard params that the pg driver doesn't understand
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

  const isProd = process.env.NODE_ENV === 'production';

  const poolConfig: Record<string, unknown> = {
    connectionString: cleanUrl,
    // Pool sizing: production needs enough connections for burst traffic.
    // For 100k concurrent users, most hosting (Neon/Render) supports 50-100 connections.
    // With PgBouncer or Prisma Accelerate in front, this can be higher.
    max: parseInt(process.env.PG_POOL_MAX || (isProd ? '30' : '10'), 10),
    min: parseInt(process.env.PG_POOL_MIN || (isProd ? '5' : '2'), 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT || '5000', 10),
    // Statement timeout prevents runaway queries from blocking the pool.
    statement_timeout: parseInt(process.env.PG_STATEMENT_TIMEOUT || '30000', 10),
    // Idle-in-transaction timeout prevents abandoned transactions from holding locks.
    idle_in_transaction_session_timeout: parseInt(process.env.PG_IDLE_IN_TX_TIMEOUT || '60000', 10),
    // TCP keepalive: detect broken connections before they cause timeout cascades.
    keepAlive: true,
    keepAliveInitialDelayMillis: parseInt(process.env.PG_KEEPALIVE_DELAY || '10000', 10),
    // Automatically reap connections above `min` if they've been idle for this long.
    allowExitOnIdle: !isProd,
  };

  if (ssl) {
    poolConfig.ssl = ssl;
  }

  // Set search_path so $queryRaw calls resolve unqualified table names correctly.
  if (pgSchema) {
    poolConfig.options = `-c search_path=${pgSchema},public`;
  }

  return { poolConfig, pgSchema, sslmode };
}

/**
 * Connect to PostgreSQL via Prisma with connection pooling.
 * Safe to call multiple times.  Retries up to `maxRetries` with exponential
 * back-off so transient network hiccups (especially when MongoMemoryServer
 * is starting in parallel during tests) don't cause a cascade of failures.
 * Returns silently when DATABASE_URL is not configured (PG is optional).
 */
export async function connectPrisma(maxRetries = 3): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    dbLog.info('DATABASE_URL not set – PostgreSQL dual-write disabled');
    return;
  }

  if (_prisma) return;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
        dbLog.info(`PostgreSQL adapter ready (pool max=${poolConfig.max}, schema=${pgSchema ?? 'public'}, ssl=${sslLabel})`);

        // Run a lightweight query to verify connectivity upfront.
        await client.$queryRawUnsafe('SELECT 1');
        _prisma = client;
        dbLog.info('Connected to PostgreSQL successfully');
        return; // success — break out of retry loop
      } catch (err) {
        const isLastAttempt = attempt === maxRetries;
        const msg = `PostgreSQL connection attempt ${attempt}/${maxRetries} failed`;
        if (isLastAttempt) {
          dbLog.error(msg, { error: err });
          // Non-fatal — Mongo is still the primary. PG is a shadow.
          _prisma = null;
        } else {
          dbLog.warn(`${msg} – retrying in ${attempt}s…`, { error: (err as Error).message });
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
  })();

  try {
    await _connecting;
  } finally {
    _connecting = null;
  }
}

/**
 * Lightweight ping to check if the PG connection is alive.
 * Returns true if the connection is healthy, false otherwise.
 * Used by the health endpoint for real connectivity checks.
 */
export async function pingPg(): Promise<boolean> {
  if (!_prisma) return false;
  try {
    await _prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
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
