import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

import mongoose from 'mongoose';


function redactMongoUri(uri: string): string {
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!match) return '<redacted>';
  const proto = match[1];
  const rest = match[2];
  const noCreds = rest.replace(/^[^@]+@/, '');
  const hosts = noCreds.split('/')[0] ?? '';
  return `${proto}${hosts}/...`;
}

function isLocalishMongoUri(uri: string): boolean {
  const u = uri.toLowerCase();
  if (u.includes('replace_me')) return true;
  if (u.includes('localhost')) return true;
  if (u.includes('127.0.0.1')) return true;
  if (u.includes('0.0.0.0')) return true;
  return false;
}

function requireWipeConfirmation(env: ReturnType<typeof loadEnv>) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to wipe DB in production (NODE_ENV=production).');
  }

  const must = (name: string, expected: string) => {
    const v = (process.env as any)[name];
    if (String(v ?? '') !== expected) {
      throw new Error(`Refusing to wipe DB. Set ${name}=${expected} to confirm.`);
    }
  };

  must('WIPE_DB', 'true');
  must('WIPE_DB_CONFIRM', 'WIPE');

  const uri = String(process.env.MONGODB_URI ?? '');
  if (!uri) throw new Error('Missing MONGODB_URI.');

  const allowRemote = String(process.env.WIPE_DB_ALLOW_REMOTE ?? '') === 'true';
  if (!allowRemote && !isLocalishMongoUri(uri)) {
    throw new Error(
      `Refusing to wipe a non-local MongoDB URI (${redactMongoUri(uri)}). Set WIPE_DB_ALLOW_REMOTE=true if you are 100% sure.`
    );
  }
}

async function wipeAll() {
  // Drop the whole DB for a true clean slate (collections + indexes).
  // This is safer than trying to enumerate every collection.
  if (!mongoose.connection?.db) {
    throw new Error('MongoDB not connected; cannot drop database.');
  }

  await mongoose.connection.db.dropDatabase();
}

async function seedAdmin() {
  const mod = await import('../seeds/admin.js');
  if (typeof (mod as any).seedAdminOnly !== 'function') {
    throw new Error('Missing export seedAdminOnly in ../seeds/admin.js');
  }

  const mobile = process.env.ADMIN_SEED_MOBILE;
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name = process.env.ADMIN_SEED_NAME;

  await (mod as any).seedAdminOnly({ mobile, username, password, name });
}

async function main() {
  const env = loadEnv();
  requireWipeConfirmation(env);

  await connectMongo(env);

  // eslint-disable-next-line no-console
  console.log(`Resetting DB at ${redactMongoUri(String(process.env.MONGODB_URI ?? ''))}`);

  await wipeAll();
  await seedAdmin();

  // eslint-disable-next-line no-console
  console.log('✅ DB reset complete (admin only)');
  // eslint-disable-next-line no-console
  console.log(`Admin username: ${process.env.ADMIN_SEED_USERNAME || 'root'}`);
  // eslint-disable-next-line no-console
  console.log(`Admin password: ${process.env.ADMIN_SEED_PASSWORD || 'ChangeMe_123!'}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
