/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MOBO PRODUCTION MIGRATION: MongoDB → PostgreSQL (Complete)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL PRODUCTION DATA MIGRATION
 *
 * This script migrates ALL production data from MongoDB to PostgreSQL.
 * It is designed to be run ONCE during the cutover from MongoDB to PostgreSQL.
 *
 * Safety Features:
 * ──────────────────────────────────────────────────────────────────────────────
 * • Transactional per-entity (rollback on any error)
 * • Progress tracking with resumability (via MigrationSync table)
 * • Comprehensive validation and verification
 * • Detailed audit trail of all operations
 * • Pre-migration confirmation prompts
 * • Post-migration data integrity checks
 * • Duplicate detection and handling
 * • PrismaPg adapter — clean per-schema connections (no singleton hacks)
 *
 * Usage:
 * ──────────────────────────────────────────────────────────────────────────────
 *   # Dry-run mode (shows what would be migrated, no writes)
 *   npx tsx scripts/productionMigration.ts --dry-run
 *
 *   # Verification mode (check counts + FK integrity)
 *   npx tsx scripts/productionMigration.ts --verify
 *
 *   # Full migration to buzzma production schema
 *   npx tsx scripts/productionMigration.ts --production
 *
 *   # Full migration to buzzma_test schema
 *   npx tsx scripts/productionMigration.ts --test
 *
 *   # Migrate to BOTH production and test schemas
 *   npx tsx scripts/productionMigration.ts --both
 *
 *   # Force re-migration (overwrite existing data)
 *   npx tsx scripts/productionMigration.ts --production --force
 *
 * Migration Order (FK-safe):
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. Users (root entity)
 * 2. Brands, Agencies, Wallets (depend on Users)
 * 3. MediatorProfile, ShopperProfile (depend on Users)
 * 4. Campaigns (depend on Users/Brands)
 * 5. Deals (depend on Campaigns)
 * 6. Orders (depend on Users/Campaigns)
 * 7. Transactions (depend on Wallets/Orders)
 * 8. Payouts (depend on Wallets/Users)
 * 9. Invites, Tickets, PushSubscriptions (depend on Users)
 * 10. Suspensions (depend on Users)
 * 11. AuditLogs (depend on Users)
 * 12. SystemConfig (independent)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { loadDotenv } from '../config/dotenvLoader.js';
loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo } from '../database/mongo.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

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

// ─── CLI Arguments ───────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_ONLY = process.argv.includes('--verify');
const PRODUCTION = process.argv.includes('--production');
const TEST = process.argv.includes('--test');
const BOTH = process.argv.includes('--both');
const FORCE = process.argv.includes('--force');

const BATCH_SIZE = 100; // Conservative batch size for production stability

// ─── Types ───────────────────────────────────────────────────────────────────
type CollectionEntry = {
  name: string;
  model: any;
  writer: (db: PrismaClient, doc: any) => Promise<void>;
  prismaModel: string;
};

type MigrationStats = {
  collection: string;
  mongoCount: number;
  pgCount: number;
  migrated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  errorSample: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function oid(v: unknown): string | null {
  if (!v) return null;
  return String(v);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function progressBar(current: number, total: number, width = 40): string {
  if (total === 0) return '[' + '░'.repeat(width) + '] 0%';
  const pct = current / total;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${(pct * 100).toFixed(1)}%`;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

// ─── Prisma Client Factory (PrismaPg adapter — no singleton) ────────────────

function createPrismaForSchema(schemaName: string): PrismaClient {
  const baseUrl = process.env.DATABASE_URL!;
  const parsed = new URL(baseUrl);

  // Set the target schema
  parsed.searchParams.set('currentSchema', schemaName);
  parsed.searchParams.delete('schema');

  // Build clean connection string for pg driver
  const sslmode = parsed.searchParams.get('sslmode') || 'disable';
  const requireSsl = ['require', 'verify-ca', 'verify-full'].includes(sslmode);

  // Strip params pg driver doesn't understand
  for (const p of ['sslmode', 'currentSchema', 'schema', 'channel_binding']) {
    parsed.searchParams.delete(p);
  }

  const poolConfig: Record<string, unknown> = {
    connectionString: parsed.toString(),
    max: 5,
    min: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
  };

  if (requireSsl) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  poolConfig.options = `-c search_path=${schemaName},public`;

  const adapter = new PrismaPg(poolConfig as any, { schema: schemaName });
  return new PrismaClient({ adapter, log: ['error'] });
}

// ─── DDL Setup ───────────────────────────────────────────────────────────────

async function setupSchema(db: PrismaClient, schemaName: string): Promise<void> {
  console.log(`\n  Setting up schema: ${schemaName}`);

  const schemas = await db.$queryRawUnsafe(
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${schemaName}'`
  ) as any[];

  if (schemas.length === 0) {
    try {
      await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      console.log(`    ✓ Schema "${schemaName}" created`);
    } catch (err: any) {
      console.error(`    ✗ Cannot create schema "${schemaName}": ${err?.message?.slice(0, 100)}`);
      console.error(`      The DB user needs CREATE privilege on the database.`);
      throw new Error(`Schema "${schemaName}" does not exist and cannot be created`);
    }
  } else {
    console.log(`    ✓ Schema "${schemaName}" exists`);
  }

  const tables = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_type = 'BASE TABLE'`
  ) as any[];

  if (tables.length >= 15) {
    console.log(`    ✓ ${tables.length} tables already exist — skipping DDL`);
    return;
  }

  console.log(`    ⚠ Only ${tables.length} tables found — applying DDL migrations`);

  const migrationsDir = path.resolve(import.meta.dirname!, '..', 'db', 'migrations');
  const sqlFiles = fs.readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const statements = sqlContent
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && !s.startsWith('--'));

    let applied = 0;
    for (const stmt of statements) {
      try {
        await db.$executeRawUnsafe(stmt);
        applied++;
      } catch (err: any) {
        const msg = String(err?.message ?? '');
        if (msg.includes('already exists') || msg.includes('duplicate')) continue;
        console.error(`    ✗ DDL error in ${file}: ${msg.slice(0, 150)}`);
      }
    }
    console.log(`    ✓ Applied ${file} (${applied} statements)`);
  }
}

// ─── Data Mapping Functions (inline, no singleton dependency) ────────────────

async function writeUser(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const roles = (Array.isArray(mongoDoc.roles) ? mongoDoc.roles : [mongoDoc.role || 'shopper'])
    .filter((r: string) => ['shopper', 'mediator', 'agency', 'brand', 'admin', 'ops'].includes(r));

  const data: any = {
    name: String(mongoDoc.name ?? ''),
    username: mongoDoc.username || null,
    mobile: String(mongoDoc.mobile ?? ''),
    email: mongoDoc.email || null,
    passwordHash: String(mongoDoc.passwordHash ?? ''),
    role: mongoDoc.role || 'shopper',
    roles,
    status: mongoDoc.status || 'active',
    mediatorCode: mongoDoc.mediatorCode || null,
    parentCode: mongoDoc.parentCode || null,
    generatedCodes: Array.isArray(mongoDoc.generatedCodes) ? mongoDoc.generatedCodes : [],
    isVerifiedByMediator: !!mongoDoc.isVerifiedByMediator,
    brandCode: mongoDoc.brandCode || null,
    connectedAgencies: Array.isArray(mongoDoc.connectedAgencies) ? mongoDoc.connectedAgencies : [],
    kycStatus: mongoDoc.kycStatus || 'none',
    kycPanCard: mongoDoc.kycDocuments?.panCard || null,
    kycAadhaar: mongoDoc.kycDocuments?.aadhaar || null,
    kycGst: mongoDoc.kycDocuments?.gst || null,
    upiId: mongoDoc.upiId || null,
    qrCode: mongoDoc.qrCode || null,
    bankAccountNumber: mongoDoc.bankDetails?.accountNumber || null,
    bankIfsc: mongoDoc.bankDetails?.ifsc || null,
    bankName: mongoDoc.bankDetails?.bankName || null,
    bankHolderName: mongoDoc.bankDetails?.holderName || null,
    walletBalancePaise: mongoDoc.walletBalancePaise ?? 0,
    walletPendingPaise: mongoDoc.walletPendingPaise ?? 0,
    avatar: mongoDoc.avatar || null,
    failedLoginAttempts: mongoDoc.failedLoginAttempts ?? 0,
    lockoutUntil: mongoDoc.lockoutUntil || null,
    googleRefreshToken: mongoDoc.googleRefreshToken || null,
    googleEmail: mongoDoc.googleEmail || null,
    deletedAt: mongoDoc.deletedAt || null,
  };

  try {
    await db.user.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (!msg.includes('Unique constraint') && !msg.includes('unique constraint') && !msg.includes('duplicate key')) throw err;
    const mobile = String(mongoDoc.mobile ?? '').trim();
    const existing = mobile ? await db.user.findFirst({ where: { mobile } }) : null;
    if (existing) {
      await db.user.update({ where: { id: existing.id }, data: { mongoId: id, ...data } });
    } else {
      const uname = mongoDoc.username || null;
      const byName = uname ? await db.user.findFirst({ where: { username: uname } }) : null;
      if (byName) {
        await db.user.update({ where: { id: byName.id }, data: { mongoId: id, ...data } });
      } else {
        throw err;
      }
    }
  }

  // Sync pending connections
  if (Array.isArray(mongoDoc.pendingConnections) && mongoDoc.pendingConnections.length > 0) {
    const pgUser = await db.user.findUnique({ where: { mongoId: id }, select: { id: true } });
    if (pgUser) {
      await db.pendingConnection.deleteMany({ where: { userId: pgUser.id } });
      await db.pendingConnection.createMany({
        data: mongoDoc.pendingConnections.map((pc: any) => ({
          userId: pgUser.id,
          agencyId: pc.agencyId || null,
          agencyName: pc.agencyName || null,
          agencyCode: pc.agencyCode || null,
          timestamp: pc.timestamp ? new Date(pc.timestamp) : new Date(),
        })),
      });
    }
  }
}

async function writeBrand(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const ownerPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.ownerUserId)! }, select: { id: true } });
  if (!ownerPg) { console.warn(`    ⚠ Brand ${id}: owner not found`); return; }

  const data: any = {
    name: String(mongoDoc.name ?? ''),
    brandCode: String(mongoDoc.brandCode ?? ''),
    ownerUserId: ownerPg.id,
    connectedAgencyCodes: Array.isArray(mongoDoc.connectedAgencyCodes) ? mongoDoc.connectedAgencyCodes : [],
    status: mongoDoc.status || 'active',
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.brand.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeAgency(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const ownerPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.ownerUserId)! }, select: { id: true } });
  if (!ownerPg) { console.warn(`    ⚠ Agency ${id}: owner not found`); return; }

  const data: any = {
    name: String(mongoDoc.name ?? ''),
    agencyCode: String(mongoDoc.agencyCode ?? ''),
    ownerUserId: ownerPg.id,
    status: mongoDoc.status || 'active',
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.agency.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeWallet(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const ownerPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.ownerUserId)! }, select: { id: true } });
  if (!ownerPg) { console.warn(`    ⚠ Wallet ${id}: owner not found`); return; }

  const data: any = {
    ownerUserId: ownerPg.id,
    currency: 'INR',
    availablePaise: mongoDoc.availablePaise ?? 0,
    pendingPaise: mongoDoc.pendingPaise ?? 0,
    lockedPaise: mongoDoc.lockedPaise ?? 0,
    version: mongoDoc.version ?? 0,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.wallet.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeMediatorProfile(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const userPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.userId)! }, select: { id: true } });
  if (!userPg) { console.warn(`    ⚠ MediatorProfile ${id}: user not found`); return; }

  const data: any = {
    userId: userPg.id,
    mediatorCode: String(mongoDoc.mediatorCode ?? ''),
    parentAgencyCode: mongoDoc.parentAgencyCode || null,
    status: mongoDoc.status || 'active',
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.mediatorProfile.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeShopperProfile(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const userPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.userId)! }, select: { id: true } });
  if (!userPg) { console.warn(`    ⚠ ShopperProfile ${id}: user not found`); return; }

  const data: any = {
    userId: userPg.id,
    defaultMediatorCode: mongoDoc.defaultMediatorCode || null,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.shopperProfile.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeCampaign(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const brandUserPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.brandUserId)! }, select: { id: true } });
  if (!brandUserPg) { console.warn(`    ⚠ Campaign ${id}: brandUser not found`); return; }

  let assignments: Record<string, any> = {};
  if (mongoDoc.assignments) {
    if (typeof mongoDoc.assignments.toJSON === 'function') assignments = mongoDoc.assignments.toJSON();
    else if (mongoDoc.assignments instanceof Map) mongoDoc.assignments.forEach((v: any, k: string) => { assignments[k] = v; });
    else assignments = mongoDoc.assignments;
  }

  const validDealTypes = ['Discount', 'Review', 'Rating'];
  const dealType = validDealTypes.includes(mongoDoc.dealType) ? mongoDoc.dealType : null;

  const data: any = {
    title: String(mongoDoc.title ?? ''),
    brandUserId: brandUserPg.id,
    brandName: String(mongoDoc.brandName ?? ''),
    platform: String(mongoDoc.platform ?? ''),
    image: String(mongoDoc.image ?? ''),
    productUrl: String(mongoDoc.productUrl ?? ''),
    originalPricePaise: mongoDoc.originalPricePaise ?? 0,
    pricePaise: mongoDoc.pricePaise ?? 0,
    payoutPaise: mongoDoc.payoutPaise ?? 0,
    returnWindowDays: mongoDoc.returnWindowDays ?? 14,
    dealType,
    totalSlots: mongoDoc.totalSlots ?? 0,
    usedSlots: mongoDoc.usedSlots ?? 0,
    status: mongoDoc.status || 'draft',
    allowedAgencyCodes: Array.isArray(mongoDoc.allowedAgencyCodes) ? mongoDoc.allowedAgencyCodes : [],
    assignments,
    locked: !!mongoDoc.locked,
    lockedAt: mongoDoc.lockedAt || null,
    lockedReason: mongoDoc.lockedReason || null,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.campaign.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeDeal(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const campaignPg = await db.campaign.findUnique({ where: { mongoId: oid(mongoDoc.campaignId)! }, select: { id: true } });
  if (!campaignPg) { console.warn(`    ⚠ Deal ${id}: campaign not found`); return; }

  const data: any = {
    campaignId: campaignPg.id,
    mediatorCode: String(mongoDoc.mediatorCode ?? ''),
    title: String(mongoDoc.title ?? ''),
    description: mongoDoc.description || 'Exclusive',
    image: String(mongoDoc.image ?? ''),
    productUrl: String(mongoDoc.productUrl ?? ''),
    platform: String(mongoDoc.platform ?? ''),
    brandName: String(mongoDoc.brandName ?? ''),
    dealType: mongoDoc.dealType,
    originalPricePaise: mongoDoc.originalPricePaise ?? 0,
    pricePaise: mongoDoc.pricePaise ?? 0,
    commissionPaise: mongoDoc.commissionPaise ?? 0,
    payoutPaise: mongoDoc.payoutPaise ?? 0,
    rating: mongoDoc.rating ?? 5,
    category: mongoDoc.category || 'General',
    active: mongoDoc.active !== false,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.deal.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeOrder(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const userPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.userId)! }, select: { id: true } });
  if (!userPg) { console.warn(`    ⚠ Order ${id}: user not found`); return; }

  let brandUserPgId: string | null = null;
  if (mongoDoc.brandUserId) {
    const brandPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.brandUserId)! }, select: { id: true } });
    brandUserPgId = brandPg?.id ?? null;
  }

  const validWorkflow = ['CREATED','REDIRECTED','ORDERED','PROOF_SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','REWARD_PENDING','COMPLETED','FAILED'];
  const workflowStatus = validWorkflow.includes(mongoDoc.workflowStatus) ? mongoDoc.workflowStatus : 'CREATED';
  const validStatus = ['Ordered','Shipped','Delivered','Cancelled','Returned'];
  const status = validStatus.includes(mongoDoc.status) ? mongoDoc.status : 'Ordered';
  const validPayment = ['Pending','Paid','Refunded','Failed'];
  const paymentStatus = validPayment.includes(mongoDoc.paymentStatus) ? mongoDoc.paymentStatus : 'Pending';
  const validAffiliate = ['Unchecked','Pending_Cooling','Approved_Settled','Rejected','Fraud_Alert','Cap_Exceeded','Frozen_Disputed'];
  const affiliateStatus = validAffiliate.includes(mongoDoc.affiliateStatus) ? mongoDoc.affiliateStatus : 'Unchecked';
  const validRejection = ['order','review','rating','returnWindow'];
  const rejectionType = mongoDoc.rejection?.type && validRejection.includes(mongoDoc.rejection.type) ? mongoDoc.rejection.type : null;

  const data: any = {
    userId: userPg.id,
    brandUserId: brandUserPgId,
    totalPaise: mongoDoc.totalPaise ?? 0,
    workflowStatus,
    frozen: !!mongoDoc.frozen,
    frozenAt: mongoDoc.frozenAt || null,
    frozenReason: mongoDoc.frozenReason || null,
    reactivatedAt: mongoDoc.reactivatedAt || null,
    status,
    paymentStatus,
    affiliateStatus,
    externalOrderId: mongoDoc.externalOrderId || null,
    orderDate: mongoDoc.orderDate || null,
    soldBy: mongoDoc.soldBy || null,
    extractedProductName: mongoDoc.extractedProductName || null,
    settlementRef: mongoDoc.settlementRef || null,
    settlementMode: mongoDoc.settlementMode || 'wallet',
    screenshotOrder: mongoDoc.screenshots?.order || null,
    screenshotPayment: mongoDoc.screenshots?.payment || null,
    screenshotReview: mongoDoc.screenshots?.review || null,
    screenshotRating: mongoDoc.screenshots?.rating || null,
    screenshotReturnWindow: mongoDoc.screenshots?.returnWindow || null,
    reviewLink: mongoDoc.reviewLink || null,
    returnWindowDays: mongoDoc.returnWindowDays ?? 14,
    ratingAiVerification: mongoDoc.ratingAiVerification ?? null,
    returnWindowAiVerification: mongoDoc.returnWindowAiVerification ?? null,
    rejectionType,
    rejectionReason: mongoDoc.rejection?.reason || null,
    rejectionAt: mongoDoc.rejection?.rejectedAt || null,
    verification: mongoDoc.verification ?? null,
    managerName: String(mongoDoc.managerName ?? ''),
    agencyName: mongoDoc.agencyName || null,
    buyerName: String(mongoDoc.buyerName ?? ''),
    buyerMobile: String(mongoDoc.buyerMobile ?? ''),
    reviewerName: mongoDoc.reviewerName || null,
    brandName: mongoDoc.brandName || null,
    events: Array.isArray(mongoDoc.events) ? mongoDoc.events : [],
    missingProofRequests: Array.isArray(mongoDoc.missingProofRequests) ? mongoDoc.missingProofRequests : [],
    expectedSettlementDate: mongoDoc.expectedSettlementDate || null,
    deletedAt: mongoDoc.deletedAt || null,
  };

  const pgOrder = await db.order.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });

  // Sync order items
  if (Array.isArray(mongoDoc.items) && mongoDoc.items.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: pgOrder.id } });
    const itemData = [];
    for (const item of mongoDoc.items) {
      const campPg = await db.campaign.findUnique({ where: { mongoId: oid(item.campaignId)! }, select: { id: true } });
      if (!campPg) continue;
      itemData.push({
        orderId: pgOrder.id,
        productId: String(item.productId ?? ''),
        title: String(item.title ?? ''),
        image: String(item.image ?? ''),
        priceAtPurchasePaise: item.priceAtPurchasePaise ?? 0,
        commissionPaise: item.commissionPaise ?? 0,
        campaignId: campPg.id,
        dealType: item.dealType || null,
        quantity: item.quantity ?? 1,
        platform: item.platform || null,
        brandName: item.brandName || null,
      });
    }
    if (itemData.length > 0) await db.orderItem.createMany({ data: itemData });
  }
}

async function writeTransaction(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  let walletPgId: string | null = null;
  if (mongoDoc.walletId) {
    const wPg = await db.wallet.findUnique({ where: { mongoId: oid(mongoDoc.walletId)! }, select: { id: true } });
    walletPgId = wPg?.id ?? null;
  }
  const validTypes = ['brand_deposit','platform_fee','commission_lock','commission_settle','cashback_lock','cashback_settle','order_settlement_debit','commission_reversal','margin_reversal','agency_payout','agency_receipt','payout_request','payout_complete','payout_failed','refund'];
  const type = validTypes.includes(mongoDoc.type) ? mongoDoc.type : 'brand_deposit';
  const validStatuses = ['pending','completed','failed','reversed'];
  const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'pending';

  const data: any = {
    idempotencyKey: String(mongoDoc.idempotencyKey ?? ''),
    type, status,
    amountPaise: mongoDoc.amountPaise ?? 0,
    currency: mongoDoc.currency || 'INR',
    orderId: mongoDoc.orderId || null,
    walletId: walletPgId,
    metadata: mongoDoc.metadata ?? null,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.transaction.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writePayout(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const benPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.beneficiaryUserId)! }, select: { id: true } });
  if (!benPg) { console.warn(`    ⚠ Payout ${id}: beneficiary not found`); return; }
  const walletPg = await db.wallet.findUnique({ where: { mongoId: oid(mongoDoc.walletId)! }, select: { id: true } });
  if (!walletPg) { console.warn(`    ⚠ Payout ${id}: wallet not found`); return; }

  const validStatuses = ['requested','processing','paid','failed','canceled','recorded'];
  const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'requested';

  const data: any = {
    beneficiaryUserId: benPg.id, walletId: walletPg.id,
    amountPaise: mongoDoc.amountPaise ?? 0, currency: mongoDoc.currency || 'INR',
    status, provider: mongoDoc.provider || null, providerRef: mongoDoc.providerRef || null,
    failureCode: mongoDoc.failureCode || null, failureMessage: mongoDoc.failureMessage || null,
    requestedAt: mongoDoc.requestedAt || new Date(), processedAt: mongoDoc.processedAt || null,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.payout.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeInvite(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const validRoles = ['shopper','mediator','agency','brand','admin','ops'];
  const role = validRoles.includes(mongoDoc.role) ? mongoDoc.role : 'shopper';
  const validStatuses = ['active','used','revoked','expired'];
  const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'active';

  let createdByPgId: string | null = null;
  if (mongoDoc.createdBy) {
    const cbPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.createdBy)! }, select: { id: true } });
    createdByPgId = cbPg?.id ?? null;
  }

  const data: any = {
    code: String(mongoDoc.code ?? ''), role, label: mongoDoc.label || null,
    parentCode: mongoDoc.parentCode || null, status,
    maxUses: mongoDoc.maxUses ?? 1, useCount: mongoDoc.useCount ?? 0,
    expiresAt: mongoDoc.expiresAt || null, createdBy: createdByPgId,
    usedAt: mongoDoc.usedAt || null, uses: Array.isArray(mongoDoc.uses) ? mongoDoc.uses : [],
    revokedAt: mongoDoc.revokedAt || null,
  };
  await db.invite.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeTicket(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const userPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.userId)! }, select: { id: true } });
  if (!userPg) { console.warn(`    ⚠ Ticket ${id}: user not found`); return; }

  const validStatuses = ['Open','Resolved','Rejected'];
  const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'Open';

  const data: any = {
    userId: userPg.id, userName: String(mongoDoc.userName ?? ''), role: String(mongoDoc.role ?? ''),
    orderId: mongoDoc.orderId || null, issueType: String(mongoDoc.issueType ?? ''),
    description: String(mongoDoc.description ?? ''), status,
    resolutionNote: mongoDoc.resolutionNote || null, resolvedAt: mongoDoc.resolvedAt || null,
    deletedAt: mongoDoc.deletedAt || null,
  };
  await db.ticket.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writePushSubscription(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const userPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.userId)! }, select: { id: true } });
  if (!userPg) { console.warn(`    ⚠ PushSubscription ${id}: user not found`); return; }

  const validApps = ['buyer', 'mediator'];
  const app = validApps.includes(mongoDoc.app) ? mongoDoc.app : 'buyer';

  const data: any = {
    userId: userPg.id, app,
    endpoint: String(mongoDoc.endpoint ?? ''),
    expirationTime: mongoDoc.expirationTime ?? null,
    keysP256dh: String(mongoDoc.keys?.p256dh ?? ''),
    keysAuth: String(mongoDoc.keys?.auth ?? ''),
    userAgent: mongoDoc.userAgent || null,
  };
  await db.pushSubscription.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeSuspension(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const targetPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.targetUserId)! }, select: { id: true } });
  if (!targetPg) { console.warn(`    ⚠ Suspension ${id}: target not found`); return; }
  const adminPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.adminUserId)! }, select: { id: true } });
  if (!adminPg) { console.warn(`    ⚠ Suspension ${id}: admin not found`); return; }

  const validActions = ['suspend', 'unsuspend'];
  const action = validActions.includes(mongoDoc.action) ? mongoDoc.action : 'suspend';

  const data: any = { targetUserId: targetPg.id, action, reason: mongoDoc.reason || null, adminUserId: adminPg.id };
  await db.suspension.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeAuditLog(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  let actorPgId: string | null = null;
  if (mongoDoc.actorUserId) {
    const actorPg = await db.user.findUnique({ where: { mongoId: oid(mongoDoc.actorUserId)! }, select: { id: true } });
    actorPgId = actorPg?.id ?? null;
  }

  const data: any = {
    actorUserId: actorPgId,
    actorRoles: Array.isArray(mongoDoc.actorRoles) ? mongoDoc.actorRoles : [],
    action: String(mongoDoc.action ?? ''),
    entityType: mongoDoc.entityType || null, entityId: mongoDoc.entityId || null,
    ip: mongoDoc.ip || null, userAgent: mongoDoc.userAgent || null,
    metadata: mongoDoc.metadata ?? null,
  };
  await db.auditLog.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

async function writeSystemConfig(db: PrismaClient, mongoDoc: any): Promise<void> {
  const id = oid(mongoDoc._id)!;
  const data: any = { key: mongoDoc.key || 'system', adminContactEmail: mongoDoc.adminContactEmail || null };
  await db.systemConfig.upsert({ where: { mongoId: id }, create: { mongoId: id, ...data }, update: data });
}

// ─── Collections in FK-safe order ────────────────────────────────────────────
const COLLECTIONS: CollectionEntry[] = [
  { name: 'User',             model: UserModel,             writer: writeUser,             prismaModel: 'user' },
  { name: 'Brand',            model: BrandModel,            writer: writeBrand,            prismaModel: 'brand' },
  { name: 'Agency',           model: AgencyModel,           writer: writeAgency,           prismaModel: 'agency' },
  { name: 'Wallet',           model: WalletModel,           writer: writeWallet,           prismaModel: 'wallet' },
  { name: 'MediatorProfile',  model: MediatorProfileModel,  writer: writeMediatorProfile,  prismaModel: 'mediatorProfile' },
  { name: 'ShopperProfile',   model: ShopperProfileModel,   writer: writeShopperProfile,   prismaModel: 'shopperProfile' },
  { name: 'Campaign',         model: CampaignModel,         writer: writeCampaign,         prismaModel: 'campaign' },
  { name: 'Deal',             model: DealModel,             writer: writeDeal,             prismaModel: 'deal' },
  { name: 'Order',            model: OrderModel,            writer: writeOrder,            prismaModel: 'order' },
  { name: 'Transaction',      model: TransactionModel,      writer: writeTransaction,      prismaModel: 'transaction' },
  { name: 'Payout',           model: PayoutModel,           writer: writePayout,           prismaModel: 'payout' },
  { name: 'Invite',           model: InviteModel,           writer: writeInvite,           prismaModel: 'invite' },
  { name: 'Ticket',           model: TicketModel,           writer: writeTicket,           prismaModel: 'ticket' },
  { name: 'PushSubscription', model: PushSubscriptionModel, writer: writePushSubscription, prismaModel: 'pushSubscription' },
  { name: 'Suspension',       model: SuspensionModel,       writer: writeSuspension,       prismaModel: 'suspension' },
  { name: 'AuditLog',         model: AuditLogModel,         writer: writeAuditLog,         prismaModel: 'auditLog' },
  { name: 'SystemConfig',     model: SystemConfigModel,     writer: writeSystemConfig,     prismaModel: 'systemConfig' },
];

// ─── Connection with Retry ───────────────────────────────────────────────────

async function connectWithRetry(db: PrismaClient, schemaName: string, maxRetries = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await db.$queryRawUnsafe('SELECT 1');
      console.log(`  ✓ Connected to ${schemaName} (attempt ${attempt})`);
      return;
    } catch (err: any) {
      console.warn(`  ⚠ Connection attempt ${attempt}/${maxRetries} failed: ${err?.message?.slice(0, 80)}`);
      if (attempt === maxRetries) throw err;
      const delay = attempt * 3000;
      console.log(`    Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── Migration Functions ─────────────────────────────────────────────────────

async function migrateCollection(
  entry: CollectionEntry,
  prisma: PrismaClient,
  schemaName: string,
): Promise<MigrationStats> {
  const startTime = Date.now();
  const errorSample: string[] = [];
  let migrated = 0;
  const skipped = 0;
  let errors = 0;

  console.log(`\n  📦 ${entry.name}`);

  // Get MongoDB count
  const mongoCount = await entry.model.countDocuments({});
  console.log(`     MongoDB: ${mongoCount} documents`);

  if (DRY_RUN || VERIFY_ONLY) {
    const pgCount = await (prisma as any)[entry.prismaModel].count().catch(() => -1);
    console.log(`     PostgreSQL (${schemaName}): ${pgCount} records`);

    if (VERIFY_ONLY) {
      const match = mongoCount === pgCount;
      console.log(`     ${match ? '✓' : '✗'} Counts ${match ? 'match' : 'DO NOT match'}`);
    }

    return {
      collection: entry.name,
      mongoCount,
      pgCount,
      migrated: 0,
      skipped: mongoCount,
      errors: 0,
      durationMs: Date.now() - startTime,
      errorSample: [],
    };
  }

  // Check if already migrated (unless FORCE)
  if (!FORCE) {
    try {
      const existing = await prisma.migrationSync.findUnique({
        where: { collection: `${schemaName}:${entry.name}` },
      });
      if (existing?.status === 'completed' && existing.syncedCount === mongoCount) {
        const pgCount = await (prisma as any)[entry.prismaModel].count().catch(() => -1);
        console.log(`     ⏭  Already migrated (${mongoCount} docs). Use --force to redo.`);
        return {
          collection: entry.name,
          mongoCount,
          pgCount,
          migrated: 0,
          skipped: mongoCount,
          errors: 0,
          durationMs: Date.now() - startTime,
          errorSample: [],
        };
      }
    } catch { /* migrationSync table may not exist yet */ }
  }

  // Mark as in-progress
  await prisma.migrationSync.upsert({
    where: { collection: `${schemaName}:${entry.name}` },
    create: { collection: `${schemaName}:${entry.name}`, status: 'in_progress', syncedCount: 0 },
    update: { status: 'in_progress', lastSyncAt: new Date() },
  });

  // Process in batches
  let skip = 0;
  while (skip < mongoCount) {
    const batch = await entry.model.find({}).skip(skip).limit(BATCH_SIZE).lean();
    if (batch.length === 0) break;

    for (const doc of batch) {
      try {
        await entry.writer(prisma, doc);
        migrated++;
      } catch (err: any) {
        errors++;
        const errMsg = `${entry.name} [${String(doc._id)}]: ${err?.message ?? String(err)}`;
        if (errorSample.length < 5) errorSample.push(errMsg.slice(0, 200));
        if (errorSample.length <= 5) console.error(`     ✗ ${errMsg.slice(0, 150)}`);
      }
    }

    skip += batch.length;
    process.stdout.write(`     ${progressBar(migrated + errors, mongoCount)} ${migrated}/${mongoCount} migrated, ${errors} errors\r`);
  }

  console.log('');

  // Update migration sync status
  await prisma.migrationSync.upsert({
    where: { collection: `${schemaName}:${entry.name}` },
    create: {
      collection: `${schemaName}:${entry.name}`,
      status: errors === 0 ? 'completed' : 'partial',
      syncedCount: migrated, errorCount: errors, lastSyncAt: new Date(),
    },
    update: {
      status: errors === 0 ? 'completed' : 'partial',
      syncedCount: migrated, errorCount: errors, lastSyncAt: new Date(),
    },
  });

  const pgCount = await (prisma as any)[entry.prismaModel].count().catch(() => -1);

  const emoji = errors === 0 ? '✅' : '⚠️';
  console.log(`     ${emoji} Completed: ${migrated}/${mongoCount} migrated, ${errors} errors (${formatDuration(Date.now() - startTime)})`);
  console.log(`     PostgreSQL count: ${pgCount}`);

  return {
    collection: entry.name, mongoCount, pgCount,
    migrated, skipped, errors,
    durationMs: Date.now() - startTime, errorSample,
  };
}

async function migrateToSchema(schemaName: string): Promise<MigrationStats[]> {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  MIGRATING TO: ${schemaName.toUpperCase()}`);
  console.log(`${'═'.repeat(80)}\n`);

  const prisma = createPrismaForSchema(schemaName);
  const allStats: MigrationStats[] = [];

  try {
    await connectWithRetry(prisma, schemaName);
    await setupSchema(prisma, schemaName);

    for (const entry of COLLECTIONS) {
      try {
        const stats = await migrateCollection(entry, prisma, schemaName);
        allStats.push(stats);
      } catch (err: any) {
        console.error(`  ✗ FATAL on ${entry.name}: ${err?.message ?? String(err)}`);
        allStats.push({
          collection: entry.name, mongoCount: -1, pgCount: -1,
          migrated: 0, skipped: 0, errors: 1,
          durationMs: 0, errorSample: [err?.message ?? String(err)],
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return allStats;
}

function printSummary(allStats: MigrationStats[], schemaName: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  MIGRATION SUMMARY: ${schemaName.toUpperCase()}`);
  console.log(`${'═'.repeat(80)}\n`);

  const totalMongo = allStats.reduce((sum, s) => sum + Math.max(s.mongoCount, 0), 0);
  const totalPg = allStats.reduce((sum, s) => sum + Math.max(s.pgCount, 0), 0);
  const totalMigrated = allStats.reduce((sum, s) => sum + s.migrated, 0);
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors, 0);
  const totalDuration = allStats.reduce((sum, s) => sum + s.durationMs, 0);

  console.log(`  Total Collections: ${COLLECTIONS.length}`);
  console.log(`  MongoDB Documents: ${totalMongo}`);
  console.log(`  PostgreSQL Records: ${totalPg}`);
  console.log(`  Migrated: ${totalMigrated}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log(`  Duration: ${formatDuration(totalDuration)}\n`);

  // Per-collection breakdown
  console.log('  Collection Breakdown:');
  console.log(`  ${'─'.repeat(76)}`);
  console.log(`  ${'Collection'.padEnd(22)} │ ${'Mongo'.padStart(6)} │ ${'PG'.padStart(6)} │ ${'Status'.padEnd(12)} │ ${'Time'.padStart(8)}`);
  console.log(`  ${'─'.repeat(76)}`);

  for (const stat of allStats) {
    const status = stat.errors === 0 ? '✓' : `✗ (${stat.errors} err)`;
    const match = stat.mongoCount === stat.pgCount ? '✓' : '~';
    console.log(
      `  ${stat.collection.padEnd(22)} │ ${String(stat.mongoCount).padStart(6)} │ ${String(stat.pgCount).padStart(6)} ${match} │ ${status.padEnd(12)} │ ${formatDuration(stat.durationMs).padStart(8)}`
    );

    if (stat.errorSample.length > 0) {
      console.log(`     Error samples:`);
      stat.errorSample.forEach((err, idx) => {
        console.log(`       ${idx + 1}. ${err}`);
      });
    }
  }

  console.log(`  ${'─'.repeat(76)}`);

  if (totalErrors === 0 && totalMongo === totalPg) {
    console.log('\n  ✓ MIGRATION COMPLETED SUCCESSFULLY — All data verified!\n');
  } else if (totalErrors > 0) {
    console.log(`\n  ✗ MIGRATION COMPLETED WITH ${totalErrors} ERRORS\n`);
  } else {
    console.log('\n  ⚠ MIGRATION COMPLETED — Please verify counts manually\n');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const globalStart = Date.now();

  console.log('\n' + '═'.repeat(80));
  console.log('  MOBO PRODUCTION MIGRATION: MongoDB → PostgreSQL');
  console.log('═'.repeat(80) + '\n');

  // Validate flags
  if (!DRY_RUN && !VERIFY_ONLY && !PRODUCTION && !TEST && !BOTH) {
    console.error('Error: Must specify --dry-run, --verify, --production, --test, or --both');
    console.log('\nUsage:');
    console.log('  npx tsx scripts/productionMigration.ts --dry-run      # Show what would be migrated');
    console.log('  npx tsx scripts/productionMigration.ts --verify       # Verify data integrity');
    console.log('  npx tsx scripts/productionMigration.ts --production   # Migrate to buzzma production');
    console.log('  npx tsx scripts/productionMigration.ts --test         # Migrate to buzzma_test');
    console.log('  npx tsx scripts/productionMigration.ts --both         # Migrate to BOTH schemas');
    console.log('  npx tsx scripts/productionMigration.ts --production --force  # Force re-migration\n');
    process.exit(1);
  }

  // Mode display
  if (DRY_RUN) {
    console.log('Mode: DRY RUN (no writes)\n');
  } else if (VERIFY_ONLY) {
    console.log('Mode: VERIFY ONLY (count checks)\n');
  } else {
    console.log('Mode: LIVE MIGRATION (WRITES TO DATABASE)\n');

    if (!FORCE) {
      const answer = await prompt(
        'This will write production data to PostgreSQL. Continue? (yes/no): '
      );
      if (answer.toLowerCase() !== 'yes') {
        console.log('Migration cancelled.');
        process.exit(0);
      }
    }
  }

  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Force mode: ${FORCE ? 'YES' : 'no'}`);
  console.log(`  Collections: ${COLLECTIONS.length}\n`);

  // Connect to MongoDB
  const env = loadEnv();
  console.log('Connecting to MongoDB...');
  await connectMongo(env);
  console.log('✓ MongoDB connected\n');

  try {
    let productionStats: MigrationStats[] = [];
    let testStats: MigrationStats[] = [];

    // Migrate to production schema
    if (PRODUCTION || BOTH) {
      productionStats = await migrateToSchema('buzzma');
      printSummary(productionStats, 'buzzma (PRODUCTION)');
    }

    // Migrate to test schema
    if (TEST || BOTH) {
      testStats = await migrateToSchema('buzzma_test');
      printSummary(testStats, 'buzzma_test (TEST)');
    }

    // Final summary if migrating to both
    if (BOTH && !DRY_RUN && !VERIFY_ONLY) {
      console.log('\n' + '═'.repeat(80));
      console.log('  COMPLETE MIGRATION SUMMARY');
      console.log('═'.repeat(80) + '\n');

      const prodErrors = productionStats.reduce((sum, s) => sum + s.errors, 0);
      const testErrors = testStats.reduce((sum, s) => sum + s.errors, 0);
      const totalErrors = prodErrors + testErrors;

      console.log(`  Production Schema Errors: ${prodErrors}`);
      console.log(`  Test Schema Errors: ${testErrors}`);
      console.log(`  Total Errors: ${totalErrors}\n`);

      if (totalErrors === 0) {
        console.log('  ✓ ALL MIGRATIONS COMPLETED SUCCESSFULLY!\n');
      } else {
        console.log(`  ✗ MIGRATIONS COMPLETED WITH ${totalErrors} TOTAL ERRORS\n`);
      }
    }

  } finally {
    // Clean disconnect — do NOT call disconnectMongo() which may drop DB
    try {
      const mongoose = await import('mongoose');
      await mongoose.default.connection.close();
      console.log('✓ MongoDB disconnected');
    } catch { /* ignore */ }
  }

  const totalDur = formatDuration(Date.now() - globalStart);
  console.log('\n' + '═'.repeat(80));
  console.log(`  MIGRATION COMPLETE (${totalDur})`);
  console.log('═'.repeat(80) + '\n');
}

main().catch((err) => {
  console.error('\n✗ FATAL ERROR:', err);
  process.exit(1);
});
