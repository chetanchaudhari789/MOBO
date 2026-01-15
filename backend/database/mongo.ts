import mongoose from 'mongoose';
import type { Env } from '../config/env.js';
import path from 'node:path';
import fs from 'node:fs';

let memoryServer: { stop: () => Promise<unknown>; getUri: () => string } | null = null;
let memoryServerInit: Promise<{ stop: () => Promise<unknown>; getUri: () => string }> | null = null;
let isIntentionalDisconnect = false;
let lastNodeEnv: Env['NODE_ENV'] | undefined;

let connectInFlight: Promise<void> | null = null;
let handlersAttached = false;

const onMongoError = (err: unknown) => {
  console.error('MongoDB connection error:', err);
};

const onMongoDisconnected = () => {
  if (isIntentionalDisconnect) return;
  console.warn('MongoDB disconnected. Attempting reconnection...');
};

const onMongoConnected = () => {
  console.log('MongoDB connected successfully');
};

const onMongoReconnected = () => {
  console.log('MongoDB reconnected');
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

    await mongoose.connect(mongoUri, {
      autoIndex: env.NODE_ENV !== 'production',
      ...(env.MONGODB_DBNAME ? { dbName: env.MONGODB_DBNAME } : {}),
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
