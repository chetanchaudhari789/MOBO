import mongoose from 'mongoose';
import type { Env } from '../config/env.js';

let memoryServer: { stop: () => Promise<unknown>; getUri: () => string } | null = null;
let isIntentionalDisconnect = false;
let lastNodeEnv: Env['NODE_ENV'] | undefined;

function looksPlaceholderMongoUri(uri: string | undefined): boolean {
  if (!uri) return true;
  const v = uri.trim();
  if (!v) return true;
  if (v.includes('REPLACE_ME')) return true;
  if (v.startsWith('<') && v.endsWith('>')) return true;
  return false;
}

export async function connectMongo(env: Env): Promise<void> {
  if (mongoose.connection.readyState >= 1) return;

  isIntentionalDisconnect = false;
  lastNodeEnv = env.NODE_ENV;

  mongoose.set('strictQuery', true);

  // Connection event handlers for monitoring and resilience
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    if (isIntentionalDisconnect) return;
    console.warn('MongoDB disconnected. Attempting reconnection...');
  });

  mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected');
  });

  let mongoUri = env.MONGODB_URI;
  if (env.NODE_ENV !== 'production' && looksPlaceholderMongoUri(mongoUri)) {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    if (!memoryServer) {
      const replset = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
        // Pin version for more deterministic behavior across developer machines.
        // Can be overridden by setting MONGOMS_VERSION in the environment.
        binary: { version: process.env.MONGOMS_VERSION || '7.0.12' },
      });
      memoryServer = replset;
    }
    mongoUri = memoryServer.getUri();
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
