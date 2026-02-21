/**
 * Backfill script – copies all existing MongoDB data to PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/backfillPg.ts
 *
 * Features:
 * - Streams each collection in batches (default 200) to avoid memory spikes.
 * - Uses MigrationSync table to track which collections have been backfilled.
 * - Idempotent: re-running skips already-synced collections unless --force flag is used.
 * - Logs progress per collection and overall summary.
 *
 * Order matters: Users must be synced first (other models reference them via mongoId FK).
 */

import { loadDotenv } from '../config/dotenvLoader.js';
loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { connectPrisma, disconnectPrisma, getPrisma } from '../database/prisma.js';

// Models
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

// Dual-write functions
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

const BATCH_SIZE = 200;
const FORCE = process.argv.includes('--force');

type CollectionEntry = {
  name: string;
  model: any;
  writer: (doc: any) => Promise<void>;
};

// Order: Users first (FK target), then entities that reference users, then the rest.
const COLLECTIONS: CollectionEntry[] = [
  { name: 'User', model: UserModel, writer: dualWriteUser },
  { name: 'Brand', model: BrandModel, writer: dualWriteBrand },
  { name: 'Agency', model: AgencyModel, writer: dualWriteAgency },
  { name: 'Wallet', model: WalletModel, writer: dualWriteWallet },
  { name: 'Campaign', model: CampaignModel, writer: dualWriteCampaign },
  { name: 'Deal', model: DealModel, writer: dualWriteDeal },
  { name: 'MediatorProfile', model: MediatorProfileModel, writer: dualWriteMediatorProfile },
  { name: 'ShopperProfile', model: ShopperProfileModel, writer: dualWriteShopperProfile },
  { name: 'Order', model: OrderModel, writer: dualWriteOrder },
  { name: 'Transaction', model: TransactionModel, writer: dualWriteTransaction },
  { name: 'Payout', model: PayoutModel, writer: dualWritePayout },
  { name: 'Invite', model: InviteModel, writer: dualWriteInvite },
  { name: 'Ticket', model: TicketModel, writer: dualWriteTicket },
  { name: 'PushSubscription', model: PushSubscriptionModel, writer: dualWritePushSubscription },
  { name: 'Suspension', model: SuspensionModel, writer: dualWriteSuspension },
  { name: 'AuditLog', model: AuditLogModel, writer: dualWriteAuditLog },
  { name: 'SystemConfig', model: SystemConfigModel, writer: dualWriteSystemConfig },
];

async function backfillCollection(entry: CollectionEntry): Promise<{ synced: number; errors: number }> {
  const db = getPrisma()!;
  let synced = 0;
  let errors = 0;

  // Check MigrationSync for previous run
  if (!FORCE) {
    const existing = await db.migrationSync.findUnique({ where: { collection: entry.name } });
    if (existing?.status === 'completed') {
      console.log(`  [skip] ${entry.name} already backfilled (${existing.syncedCount} docs). Use --force to redo.`);
      return { synced: existing.syncedCount ?? 0, errors: 0 };
    }
  }

  // Mark as in-progress
  await db.migrationSync.upsert({
    where: { collection: entry.name },
    create: { collection: entry.name, status: 'in_progress', syncedCount: 0 },
    update: { status: 'in_progress', lastSyncAt: new Date() },
  });

  const total = await entry.model.countDocuments({});
  console.log(`  [start] ${entry.name}: ${total} documents to backfill`);

  let skip = 0;
  while (skip < total) {
    const batch = await entry.model.find({}).skip(skip).limit(BATCH_SIZE).lean();
    if (batch.length === 0) break;

    // Process sequentially to avoid overwhelming the PG connection pool (max 10).
    // Promise.allSettled on 200 items causes pool exhaustion on remote PG.
    for (const doc of batch) {
      try {
        await entry.writer(doc);
        synced++;
      } catch (err: any) {
        errors++;
        console.error(`  [err] ${entry.name}:`, err?.message ?? err);
      }
    }

    skip += batch.length;
    process.stdout.write(`  [progress] ${entry.name}: ${synced}/${total} synced, ${errors} errors\r`);
  }

  console.log(`  [done] ${entry.name}: ${synced}/${total} synced, ${errors} errors`);

  // Update MigrationSync (upsert in case TRUNCATE removed tracking rows)
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

  return { synced, errors };
}

async function main() {
  console.log('=== MongoDB → PostgreSQL Backfill ===');
  console.log(`Batch size: ${BATCH_SIZE}, Force: ${FORCE}`);

  const env = loadEnv();
  await connectMongo(env);
  await connectPrisma();

  const db = getPrisma();
  if (!db) {
    console.error('Prisma client not available. Set DATABASE_URL in .env');
    process.exit(1);
  }

  // Force dual-write to be "enabled" for the backfill
  process.env.DUAL_WRITE_ENABLED = 'true';

  let totalSynced = 0;
  let totalErrors = 0;

  for (const entry of COLLECTIONS) {
    try {
      const result = await backfillCollection(entry);
      totalSynced += result.synced;
      totalErrors += result.errors;
    } catch (err: any) {
      console.error(`  [FATAL] ${entry.name}:`, err?.message ?? err);
      totalErrors++;
    }
  }

  console.log('\n=== Backfill Summary ===');
  console.log(`Total synced: ${totalSynced}`);
  console.log(`Total errors: ${totalErrors}`);

  await disconnectPrisma();
  await disconnectMongo();

  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
