import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
<<<<<<< HEAD

async function runLargeSeedImpl() {
  const mod = await import('../seeds/seed.js');
  if (typeof (mod as any).runLargeSeed !== 'function') {
    throw new Error('Missing export runLargeSeed in ../seeds/seed.js');
  }
  return (mod as any).runLargeSeed as (args: { wipe: boolean }) => Promise<unknown>;
}
=======
import { runLargeSeed } from '../seeds/seed.js';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

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

function requireResetConfirmation(env: ReturnType<typeof loadEnv>) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset seed in production (NODE_ENV=production).');
  }

  const must = (name: string, expected: string) => {
    const v = (process.env as any)[name];
    if (String(v ?? '') !== expected) {
      throw new Error(`Refusing to reset seed. Set ${name}=${expected} to confirm.`);
    }
  };

  // Require explicit opt-in.
  must('SEED_WIPE', 'true');
  must('WIPE_DB', 'true');
  must('WIPE_DB_CONFIRM', 'WIPE');

  const uri = String(process.env.MONGODB_URI ?? '');
  if (!uri) throw new Error('Missing MONGODB_URI.');

  const allowRemote = String(process.env.WIPE_DB_ALLOW_REMOTE ?? '') === 'true';
  if (!allowRemote && !isLocalishMongoUri(uri)) {
    throw new Error(
      `Refusing to reset seed on a non-local MongoDB URI (${redactMongoUri(uri)}). Set WIPE_DB_ALLOW_REMOTE=true if you are 100% sure.`
    );
  }
}

async function main() {
  const env = loadEnv();
  requireResetConfirmation(env);

  await connectMongo(env);

  // runLargeSeed performs the wipe and then seeds deterministically.
<<<<<<< HEAD
  const runLargeSeed = await runLargeSeedImpl();
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  await runLargeSeed({ wipe: true });
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
