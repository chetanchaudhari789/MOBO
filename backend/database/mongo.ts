// MongoDB removed — these are no-op stubs for backward compatibility.
import type { Env } from '../config/env.js';
import { dbLog } from '../config/logger.js';

export async function connectMongo(_env: Env): Promise<void> {
  dbLog.warn('connectMongo() is deprecated — MongoDB has been removed. This is a no-op stub.');
}

export async function disconnectMongo(): Promise<void> {
  // No-op: MongoDB has been removed.
}
