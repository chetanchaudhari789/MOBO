import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import mongoose from 'mongoose';

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { migrations } from './migrations/index.js';
import type { Migration, MigrationContext } from './migrations/types.js';

type AppliedMigration = {
  id: string;
  description: string;
  appliedAt: Date;
};

function parseArgs(argv: string[]) {
  const args = new Set(argv);
  const getValue = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  };

  return {
    statusOnly: args.has('--status'),
    dryRun: args.has('--dry-run'),
    to: getValue('--to'),
  };
}

async function getApplied(): Promise<AppliedMigration[]> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready (missing mongoose.connection.db)');
  const coll = db.collection<AppliedMigration>('schema_migrations');
  const rows = await coll.find({}).sort({ appliedAt: 1 }).toArray();
  return rows;
}

async function markApplied(m: Migration): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready (missing mongoose.connection.db)');
  const coll = db.collection<AppliedMigration>('schema_migrations');
  await coll.updateOne(
    { id: m.id },
    {
      $setOnInsert: {
        id: m.id,
        description: m.description,
        appliedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function run() {
  const env = loadEnv();
  await connectMongo(env);

  const { statusOnly, dryRun, to } = parseArgs(process.argv.slice(2));

  const applied = await getApplied();
  const appliedIds = new Set(applied.map((a) => a.id));

  const pending = migrations.filter((m) => !appliedIds.has(m.id));

  if (statusOnly) {
    log(`Applied migrations: ${applied.length}`);
    for (const a of applied) log(`  - ${a.id} (${a.appliedAt.toISOString()}): ${a.description}`);

    log(`Pending migrations: ${pending.length}`);
    for (const m of pending) log(`  - ${m.id}: ${m.description}`);

    return;
  }

  let toIndex = migrations.length - 1;
  if (to) {
    const idx = migrations.findIndex((m) => m.id === to);
    if (idx === -1) {
      throw new Error(`Unknown migration id for --to: ${to}`);
    }
    toIndex = idx;
  }

  const runnable = migrations.slice(0, toIndex + 1).filter((m) => !appliedIds.has(m.id));

  if (runnable.length === 0) {
    log('No pending migrations to run.');
    return;
  }

  const ctx: MigrationContext = {
    db: mongoose.connection.db,
    now: new Date(),
    log,
  };

  log(`Running ${runnable.length} migration(s)${dryRun ? ' (dry-run)' : ''}...`);

  for (const m of runnable) {
    log(`\n==> ${m.id}`);
    log(m.description);

    if (dryRun) continue;

    await m.up(ctx);
    await markApplied(m);
    log(`Applied: ${m.id}`);
  }
}

run()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
