/**
 * Full MongoDB → PostgreSQL Migration Script
 * ============================================
 * Transfers ALL data from MongoDB to PostgreSQL in the correct dependency order.
 *
 * Usage:
 *   npx tsx scripts/migrateMongoToPg.ts
 *   npx tsx scripts/migrateMongoToPg.ts --force     # Re-sync everything
 *   npx tsx scripts/migrateMongoToPg.ts --verify     # Verify counts only
 *   npx tsx scripts/migrateMongoToPg.ts --dry-run    # Show counts, don't write
 *
 * This script:
 * 1. Connects to both MongoDB (source) and PostgreSQL (destination)
 * 2. Migrates all 17 collections in FK-safe order (Users first)
 * 3. Processes documents one-by-one (sequential) to avoid pool exhaustion
 * 4. Tracks progress via MigrationSync table
 * 5. Verifies all counts match at the end
 * 6. Produces a full summary report
 */

import { loadDotenv } from '../config/dotenvLoader.js';
loadDotenv();

import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectPrisma, disconnectPrisma, getPrisma } from '../database/prisma.js';

// Mongoose Models
import { UserModel } from '../models/User.js';
import { BrandModel } from '../models/Brand.js';
import { AgencyModel } from '../models/Agency.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import { WalletModel } from '../models/Wallet.js';
import { TransactionModel } from '../models/Transaction.js';
import { PayoutModel } from '../models/Payout.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { InviteModel } from '../models/Invite.js';
import { TicketModel } from '../models/Ticket.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { SuspensionModel } from '../models/Suspension.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { SystemConfigModel } from '../models/SystemConfig.js';

// Dual-write functions (handle the actual Mongo→PG mapping)
import {
  dualWriteUser,
  dualWriteBrand,
  dualWriteAgency,
  dualWriteCampaign,
  dualWriteDeal,
  dualWriteOrder,
  dualWriteWallet,
  dualWriteTransaction,
  dualWritePayout,
  dualWriteMediatorProfile,
  dualWriteShopperProfile,
  dualWriteInvite,
  dualWriteTicket,
  dualWritePushSubscription,
  dualWriteSuspension,
  dualWriteAuditLog,
  dualWriteSystemConfig,
} from '../services/dualWrite.js';

// ─── CLI flags ──────────────────────────────────────────
const FORCE = process.argv.includes('--force');
const VERIFY_ONLY = process.argv.includes('--verify');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

// ─── Types ──────────────────────────────────────────────
type CollectionEntry = {
  name: string;
  model: any;
  writer: (doc: any) => Promise<void>;
  /** Prisma model name (lowercase) for count verification */
  prismaModel: string;
};

type MigrationResult = {
  collection: string;
  mongoCount: number;
  pgCount: number;
  synced: number;
  errors: number;
  skipped: boolean;
  durationMs: number;
  errorDetails: string[];
};

// ─── Collection order (FK-safe) ──────────────────────────
// Users MUST be first since every other model references them.
// Then Wallets (referenced by Transactions/Payouts).
// Then Campaigns (referenced by Deals/Orders).
// Then the rest.
const COLLECTIONS: CollectionEntry[] = [
  { name: 'User',             model: UserModel,             writer: dualWriteUser,             prismaModel: 'user' },
  { name: 'Brand',            model: BrandModel,            writer: dualWriteBrand,            prismaModel: 'brand' },
  { name: 'Agency',           model: AgencyModel,           writer: dualWriteAgency,           prismaModel: 'agency' },
  { name: 'Wallet',           model: WalletModel,           writer: dualWriteWallet,           prismaModel: 'wallet' },
  { name: 'MediatorProfile',  model: MediatorProfileModel,  writer: dualWriteMediatorProfile,  prismaModel: 'mediatorProfile' },
  { name: 'ShopperProfile',   model: ShopperProfileModel,   writer: dualWriteShopperProfile,   prismaModel: 'shopperProfile' },
  { name: 'Campaign',         model: CampaignModel,         writer: dualWriteCampaign,         prismaModel: 'campaign' },
  { name: 'Deal',             model: DealModel,             writer: dualWriteDeal,             prismaModel: 'deal' },
  { name: 'Order',            model: OrderModel,            writer: dualWriteOrder,            prismaModel: 'order' },
  { name: 'Transaction',      model: TransactionModel,      writer: dualWriteTransaction,      prismaModel: 'transaction' },
  { name: 'Payout',           model: PayoutModel,           writer: dualWritePayout,           prismaModel: 'payout' },
  { name: 'Invite',           model: InviteModel,           writer: dualWriteInvite,           prismaModel: 'invite' },
  { name: 'Ticket',           model: TicketModel,           writer: dualWriteTicket,           prismaModel: 'ticket' },
  { name: 'PushSubscription', model: PushSubscriptionModel, writer: dualWritePushSubscription, prismaModel: 'pushSubscription' },
  { name: 'Suspension',       model: SuspensionModel,       writer: dualWriteSuspension,       prismaModel: 'suspension' },
  { name: 'AuditLog',         model: AuditLogModel,         writer: dualWriteAuditLog,         prismaModel: 'auditLog' },
  { name: 'SystemConfig',     model: SystemConfigModel,     writer: dualWriteSystemConfig,     prismaModel: 'systemConfig' },
];

// ─── Helpers ────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function progressBar(current: number, total: number, width = 30): string {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `[${bar}] ${(pct * 100).toFixed(0)}%`;
}

async function getPgCount(prismaModel: string): Promise<number> {
  const db = getPrisma()!;
  try {
    return await (db as any)[prismaModel].count();
  } catch {
    return -1; // model might not yet exist
  }
}

// ─── Migration logic ────────────────────────────────────

async function migrateCollection(entry: CollectionEntry): Promise<MigrationResult> {
  const db = getPrisma()!;
  const startTime = Date.now();
  const errorDetails: string[] = [];
  let synced = 0;
  let errors = 0;

  const mongoCount = await entry.model.countDocuments({});

  // Check if already synced
  if (!FORCE) {
    const existing = await db.migrationSync.findUnique({ where: { collection: entry.name } });
    if (existing?.status === 'completed' && existing.syncedCount === mongoCount) {
      const pgCount = await getPgCount(entry.prismaModel);
      console.log(`  ⏭  ${entry.name}: already synced (${mongoCount} docs). Use --force to redo.`);
      return {
        collection: entry.name,
        mongoCount,
        pgCount,
        synced: mongoCount,
        errors: 0,
        skipped: true,
        durationMs: Date.now() - startTime,
        errorDetails: [],
      };
    }
  }

  if (DRY_RUN) {
    const pgCount = await getPgCount(entry.prismaModel);
    console.log(`  📋 ${entry.name}: ${mongoCount} docs in Mongo, ${pgCount} in PG (dry run)`);
    return {
      collection: entry.name,
      mongoCount,
      pgCount,
      synced: 0,
      errors: 0,
      skipped: true,
      durationMs: Date.now() - startTime,
      errorDetails: [],
    };
  }

  console.log(`  ▶  ${entry.name}: migrating ${mongoCount} documents...`);

  // Mark in-progress
  await db.migrationSync.upsert({
    where: { collection: entry.name },
    create: { collection: entry.name, status: 'in_progress', syncedCount: 0 },
    update: { status: 'in_progress', lastSyncAt: new Date() },
  });

  // Process in batches, sequential within each batch
  let skip = 0;
  while (skip < mongoCount) {
    const batch = await entry.model.find({}).skip(skip).limit(BATCH_SIZE).lean();
    if (batch.length === 0) break;

    for (const doc of batch) {
      try {
        await entry.writer(doc);
        synced++;
      } catch (err: any) {
        errors++;
        const msg = `${entry.name} [${String(doc._id)}]: ${err?.message ?? String(err)}`;
        errorDetails.push(msg);
        if (errorDetails.length <= 5) {
          console.error(`    ✖ ${msg}`);
        }
      }
    }

    skip += batch.length;
    process.stdout.write(`    ${progressBar(synced + errors, mongoCount)} ${synced}/${mongoCount} synced, ${errors} errors\r`);
  }
  process.stdout.write('\n');

  // Get final PG count
  const pgCount = await getPgCount(entry.prismaModel);

  // Update MigrationSync
  await db.migrationSync.upsert({
    where: { collection: entry.name },
    create: {
      collection: entry.name,
      status: errors === 0 ? 'completed' : 'partial',
      syncedCount: synced,
      errorCount: errors,
      lastSyncAt: new Date(),
    },
    update: {
      status: errors === 0 ? 'completed' : 'partial',
      syncedCount: synced,
      errorCount: errors,
      lastSyncAt: new Date(),
    },
  });

  const dur = formatDuration(Date.now() - startTime);
  const emoji = errors === 0 ? '✅' : '⚠️';
  console.log(`  ${emoji} ${entry.name}: ${synced}/${mongoCount} synced, ${errors} errors (${dur})`);
  if (errorDetails.length > 5) {
    console.log(`    ... and ${errorDetails.length - 5} more errors`);
  }

  return {
    collection: entry.name,
    mongoCount,
    pgCount,
    synced,
    errors,
    skipped: false,
    durationMs: Date.now() - startTime,
    errorDetails,
  };
}

async function verify(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               VERIFICATION: Mongo vs PG Counts             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Collection          │ MongoDB │ Postgres │ Match          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  let allMatch = true;
  for (const entry of COLLECTIONS) {
    const mongoCount = await entry.model.countDocuments({});
    const pgCount = await getPgCount(entry.prismaModel);
    const match = mongoCount === pgCount;
    if (!match) allMatch = false;
    const matchStr = match ? '  ✅ YES' : `  ❌ NO (Δ ${Math.abs(mongoCount - pgCount)})`;
    const name = entry.name.padEnd(20);
    const mc = String(mongoCount).padStart(7);
    const pc = String(pgCount).padStart(8);
    console.log(`║  ${name} │ ${mc} │ ${pc} │${matchStr.padEnd(14)}║`);
  }

  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (allMatch) {
    console.log('\n🎉 ALL COLLECTIONS MATCH! Migration is complete and verified.');
  } else {
    console.log('\n⚠️  Some collections have count mismatches. Review the errors above.');
    console.log('   Note: Some documents may have been skipped due to missing FK references.');
    console.log('   Re-run with --force to retry failed documents.');
  }
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  const globalStart = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          MOBO: MongoDB → PostgreSQL Full Migration          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode:  ${VERIFY_ONLY ? 'VERIFY ONLY' : DRY_RUN ? 'DRY RUN' : FORCE ? 'FORCE (re-sync all)' : 'INCREMENTAL'}`.padEnd(63) + '║');
  console.log(`║  Batch: ${BATCH_SIZE} docs per fetch`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Load env and connect databases
  const env = loadEnv();

  const mongoUri = process.env.MONGODB_URI || env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI is not set. Cannot connect to source database.');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DBNAME || 'mobo' });
  console.log('   ✅ MongoDB connected');

  console.log('🔌 Connecting to PostgreSQL...');
  await connectPrisma();
  const db = getPrisma();
  if (!db) {
    console.error('❌ Prisma client not available. Check DATABASE_URL in .env');
    process.exit(1);
  }
  console.log('   ✅ PostgreSQL connected');

  // Force dual-write to be enabled for the migration
  process.env.DUAL_WRITE_ENABLED = 'true';

  if (VERIFY_ONLY) {
    await verify();
    await disconnectPrisma();
    await mongoose.disconnect();
    process.exit(0);
  }

  // Run migration
  console.log('\n📊 Starting migration...\n');
  const results: MigrationResult[] = [];

  for (const entry of COLLECTIONS) {
    try {
      const result = await migrateCollection(entry);
      results.push(result);
    } catch (err: any) {
      console.error(`  ❌ FATAL ERROR on ${entry.name}: ${err?.message ?? String(err)}`);
      results.push({
        collection: entry.name,
        mongoCount: -1,
        pgCount: -1,
        synced: 0,
        errors: 1,
        skipped: false,
        durationMs: 0,
        errorDetails: [err?.message ?? String(err)],
      });
    }
  }

  // Summary
  const totalMongo = results.reduce((s, r) => s + Math.max(r.mongoCount, 0), 0);
  const totalSynced = results.reduce((s, r) => s + r.synced, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const totalDur = formatDuration(Date.now() - globalStart);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    MIGRATION SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total documents in MongoDB:  ${String(totalMongo).padStart(8)}                      ║`);
  console.log(`║  Total synced to PostgreSQL:  ${String(totalSynced).padStart(8)}                      ║`);
  console.log(`║  Total errors:                ${String(totalErrors).padStart(8)}                      ║`);
  console.log(`║  Duration:                    ${totalDur.padStart(8)}                      ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Verification
  await verify();

  // Cleanup
  await disconnectPrisma();
  await mongoose.disconnect();

  console.log(`\n✨ Migration complete in ${totalDur}`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('💥 Unhandled migration error:', err);
  process.exit(1);
});
