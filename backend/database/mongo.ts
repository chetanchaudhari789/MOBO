import mongoose from 'mongoose';
import type { Env } from '../config/env.js';

let memoryServer: { stop: () => Promise<unknown>; getUri: () => string } | null = null;
let isIntentionalDisconnect = false;

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
    const replset = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    memoryServer = replset;
    mongoUri = replset.getUri();
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
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
