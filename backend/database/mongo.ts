import mongoose from 'mongoose';
import type { Env } from '../config/env.js';
import path from 'node:path';
import fs from 'node:fs';
import { dbLog } from '../config/logger.js';

/**
 * Default database name when MONGODB_DBNAME is not set and the connection URI
 * does not contain an explicit database path.  Without this, Mongoose would
 * silently fall back to the built-in default "test", which is confusing in
 * production and can accidentally mix dev/test data with real data.
 */
const DEFAULT_DBNAME = 'mobo';

let memoryServer: { stop: () => Promise<unknown>; getUri: () => string } | null = null;
let memoryServerInit: Promise<{ stop: () => Promise<unknown>; getUri: () => string }> | null = null;
let isIntentionalDisconnect = false;
let lastNodeEnv: Env['NODE_ENV'] | undefined;

let connectInFlight: Promise<void> | null = null;
let handlersAttached = false;

const onMongoError = (err: unknown) => {
  dbLog.error('MongoDB connection error', { error: err });
};

const onMongoDisconnected = () => {
  if (isIntentionalDisconnect) return;
  dbLog.warn('MongoDB disconnected. Attempting reconnection...');
};

const onMongoConnected = () => {
  dbLog.info('MongoDB connected successfully');
};

const onMongoReconnected = () => {
  dbLog.info('MongoDB reconnected');
};

function looksPlaceholderMongoUri(uri: string | undefined): boolean {
  if (!uri) return true;
  const v = uri.trim();
  if (!v) return true;
  if (v.includes('REPLACE_ME')) return true;
  if (v.startsWith('<') && v.endsWith('>')) return true;
  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

export async function connectMongo(env: Env): Promise<void> {
  if (mongoose.connection.readyState >= 1) return;
  if (connectInFlight) return connectInFlight;

  connectInFlight = (async () => {
    if (mongoose.connection.readyState >= 1) return;

  isIntentionalDisconnect = false;
  lastNodeEnv = env.NODE_ENV;

  mongoose.set('strictQuery', true);

  // Connection event handlers for monitoring and resilience.
  // Important: connectMongo() is called repeatedly in tests, so handlers must be attached idempotently.
  if (!handlersAttached) {
    mongoose.connection.on('error', onMongoError);
    mongoose.connection.on('disconnected', onMongoDisconnected);
    mongoose.connection.on('connected', onMongoConnected);
    mongoose.connection.on('reconnected', onMongoReconnected);
    handlersAttached = true;
  }

    let mongoUri = env.MONGODB_URI;
    if (env.NODE_ENV !== 'production' && looksPlaceholderMongoUri(mongoUri)) {
      const { MongoMemoryReplSet } = await import('mongodb-memory-server');

      // Prefer a stable, workspace-local cache directory on Windows to avoid temp-drive issues.
      // This is also set in vitest.config.ts, but we keep this here so test helpers and other
      // entrypoints that call connectMongo() remain deterministic.
      const cacheDir =
        process.env.MONGOMS_DOWNLOAD_DIR ||
        process.env.TMP ||
        process.env.TEMP;
      const resolvedCacheDir = cacheDir ? path.resolve(cacheDir) : undefined;

      if (!memoryServer) {
        if (!memoryServerInit) {
          const launchTimeout = (() => {
            const raw = Number(process.env.MONGOMS_LAUNCH_TIMEOUT_MS || '');
            if (Number.isFinite(raw) && raw >= 1000) return Math.floor(raw);
            return 60_000;
          })();

          // Important: do not reuse a fixed dbPath across separate test runs.
          // On Windows, reusing a shared directory can leave stale lock files and cause mongod
          // to exit early (seen as a "connection ... closed" error during replset init).
          const dbPath = resolvedCacheDir ? fs.mkdtempSync(path.join(resolvedCacheDir, 'data-')) : undefined;

          const createPromise = MongoMemoryReplSet.create({
            replSet: { count: 1, storageEngine: 'wiredTiger' },
            ...(resolvedCacheDir
              ? {
                  binary: {
                    ...(process.env.MONGOMS_VERSION ? { version: process.env.MONGOMS_VERSION } : {}),
                    downloadDir: resolvedCacheDir,
                  },
                  instanceOpts: [
                    {
                      dbPath,
                      launchTimeout,
                    },
                  ],
                }
              : {
                  // Only pin when explicitly requested (Windows can be flaky with certain pinned versions).
                  ...(process.env.MONGOMS_VERSION ? { binary: { version: process.env.MONGOMS_VERSION } } : {}),
                  instanceOpts: [{ launchTimeout }],
                }),
          }) as any;

          // If mongodb-memory-server gets stuck (download/extract/start), fail fast instead of hanging
          // the entire test run forever.
          memoryServerInit = withTimeout(createPromise, 180_000, 'MongoMemoryReplSet.create()');
        }
        try {
          memoryServer = await memoryServerInit;
          memoryServerInit = null;
        } catch (err) {
          memoryServerInit = null;
          throw err;
        }
      }

      const ms = memoryServer;
      if (!ms) throw new Error('In-memory MongoDB failed to start');
      mongoUri = ms.getUri();
    }

    // Resolve the effective database name:
    // 1. Explicit env var  (MONGODB_DBNAME)  — highest priority
    // 2. Database name embedded in the URI   — e.g. mongodb+srv://…/mydb
    // 3. Fallback constant DEFAULT_DBNAME    — prevents Mongoose defaulting to "test"
    const resolvedDbName = (() => {
      if (env.MONGODB_DBNAME) return env.MONGODB_DBNAME;
      try {
        // For SRV URIs, URL parsing puts the db name in the pathname.
        const parsed = new URL(mongoUri);
        const dbFromUri = parsed.pathname.replace(/^\//, '').split('/')[0];
        if (dbFromUri && dbFromUri !== 'test') return undefined;   // let Mongoose use the URI path
      } catch {
        // non-standard URI format — fall through to default
      }
      return DEFAULT_DBNAME;
    })();

    if (env.NODE_ENV === 'production' && resolvedDbName === 'test') {
      dbLog.warn(
        'Production is using database name "test". ' +
        'Set MONGODB_DBNAME or include the database name in MONGODB_URI to avoid this.'
      );
    }

    dbLog.info(`MongoDB: connecting to db "${resolvedDbName ?? '(from URI)'}"`);

    await mongoose.connect(mongoUri, {
      autoIndex: env.NODE_ENV !== 'production',
      ...(resolvedDbName ? { dbName: resolvedDbName } : {}),
      // Connection pool configuration for production performance
      maxPoolSize: 50,              // Maximum number of connections
      minPoolSize: 10,              // Minimum connections maintained
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,                    // Force IPv4 to avoid DNS issues
    });
  })().finally(() => {
    connectInFlight = null;
  });

  return connectInFlight;
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  isIntentionalDisconnect = true;

  // For tests, keep the in-memory replset alive for the whole process to avoid
  // repeated start/stop on Windows (can lead to flaky mongod internal errors).
  // Drop DB to keep test isolation.
  if (lastNodeEnv === 'test') {
    try {
      await mongoose.connection.dropDatabase();
    } catch {
      // best-effort
    }
  }

  await mongoose.disconnect();

  if (memoryServer && lastNodeEnv !== 'test') {
    await memoryServer.stop();
    memoryServer = null;
  }
}
