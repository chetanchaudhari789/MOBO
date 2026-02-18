/**
 * Data verification script – compares document counts between MongoDB and PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/verifyPgSync.ts
 *
 * Reports count differences per collection and flags any mismatches.
 */

import { loadDotenv } from '../config/dotenvLoader.js';
loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { connectPrisma, disconnectPrisma, getPrisma } from '../database/prisma.js';

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

type Check = { name: string; mongoModel: any; prismaDelegate: string };

const CHECKS: Check[] = [
  { name: 'User', mongoModel: UserModel, prismaDelegate: 'user' },
  { name: 'Brand', mongoModel: BrandModel, prismaDelegate: 'brand' },
  { name: 'Agency', mongoModel: AgencyModel, prismaDelegate: 'agency' },
  { name: 'Campaign', mongoModel: CampaignModel, prismaDelegate: 'campaign' },
  { name: 'Deal', mongoModel: DealModel, prismaDelegate: 'deal' },
  { name: 'Order', mongoModel: OrderModel, prismaDelegate: 'order' },
  { name: 'Wallet', mongoModel: WalletModel, prismaDelegate: 'wallet' },
  { name: 'Transaction', mongoModel: TransactionModel, prismaDelegate: 'transaction' },
  { name: 'Payout', mongoModel: PayoutModel, prismaDelegate: 'payout' },
  { name: 'MediatorProfile', mongoModel: MediatorProfileModel, prismaDelegate: 'mediatorProfile' },
  { name: 'ShopperProfile', mongoModel: ShopperProfileModel, prismaDelegate: 'shopperProfile' },
  { name: 'Invite', mongoModel: InviteModel, prismaDelegate: 'invite' },
  { name: 'Ticket', mongoModel: TicketModel, prismaDelegate: 'ticket' },
  { name: 'PushSubscription', mongoModel: PushSubscriptionModel, prismaDelegate: 'pushSubscription' },
  { name: 'Suspension', mongoModel: SuspensionModel, prismaDelegate: 'suspension' },
  { name: 'AuditLog', mongoModel: AuditLogModel, prismaDelegate: 'auditLog' },
  { name: 'SystemConfig', mongoModel: SystemConfigModel, prismaDelegate: 'systemConfig' },
];

async function main() {
  console.log('=== MongoDB ↔ PostgreSQL Sync Verification ===\n');

  const env = loadEnv();
  await connectMongo(env);
  await connectPrisma();

  const db = getPrisma();
  if (!db) {
    console.error('Prisma client not available. Set DATABASE_URL in .env');
    process.exit(1);
  }

  let mismatches = 0;

  console.log('Collection'.padEnd(22) + 'Mongo'.padStart(8) + 'PG'.padStart(8) + '  Status');
  console.log('─'.repeat(50));

  for (const check of CHECKS) {
    const mongoCount = await check.mongoModel.countDocuments({});
    const pgCount = await (db as any)[check.prismaDelegate].count();
    const match = mongoCount === pgCount;
    if (!match) mismatches++;

    const status = match ? '✓ OK' : `✗ DIFF (${mongoCount - pgCount})`;
    console.log(
      check.name.padEnd(22) +
      String(mongoCount).padStart(8) +
      String(pgCount).padStart(8) +
      '  ' + status
    );
  }

  console.log('─'.repeat(50));
  if (mismatches === 0) {
    console.log('\nAll collections are in sync!');
  } else {
    console.log(`\n${mismatches} collection(s) have mismatches. Run backfillPg.ts to resync.`);
  }

  // Also check MigrationSync status
  const syncRecords = await db.migrationSync.findMany({ orderBy: { collection: 'asc' } });
  if (syncRecords.length > 0) {
    console.log('\n=== MigrationSync Status ===\n');
    console.log('Collection'.padEnd(22) + 'Status'.padEnd(14) + 'Synced'.padStart(8) + 'Errors'.padStart(8) + '  Last Sync');
    console.log('─'.repeat(70));
    for (const rec of syncRecords) {
      console.log(
        String(rec.collection).padEnd(22) +
        String(rec.status).padEnd(14) +
        String(rec.syncedCount ?? 0).padStart(8) +
        String(rec.errorCount ?? 0).padStart(8) +
        '  ' + (rec.lastSyncAt ? new Date(rec.lastSyncAt).toISOString() : 'never')
      );
    }
  }

  await disconnectPrisma();
  await disconnectMongo();

  process.exit(mismatches > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
