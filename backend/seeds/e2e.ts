import mongoose from 'mongoose';

import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { AgencyModel } from '../models/Agency.js';
import { BrandModel } from '../models/Brand.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import { TicketModel } from '../models/Ticket.js';
import { InviteModel } from '../models/Invite.js';
import { TransactionModel } from '../models/Transaction.js';
import { PayoutModel } from '../models/Payout.js';

import { hashPassword } from '../services/passwords.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { connectPrisma, prisma, isPrismaAvailable } from '../database/prisma.js';

export const E2E_ACCOUNTS = {
  admin: {
    name: 'E2E Admin',
    username: 'root',
    password: 'ChangeMe_123!',
    mobile: '9000000000',
  },
  agency: {
    name: 'E2E Agency',
    password: 'ChangeMe_123!',
    mobile: '9000000001',
    agencyCode: 'AG_TEST',
  },
  mediator: {
    name: 'E2E Mediator',
    password: 'ChangeMe_123!',
    mobile: '9000000002',
    mediatorCode: 'MED_TEST',
  },
  brand: {
    name: 'E2E Brand',
    password: 'ChangeMe_123!',
    mobile: '9000000003',
    brandCode: 'BRD_TEST',
  },
  shopper: {
    name: 'E2E Shopper',
    password: 'ChangeMe_123!',
    mobile: '9000000004',
  },
  shopper2: {
    name: 'E2E Shopper 2',
    password: 'ChangeMe_123!',
    mobile: '9000000005',
  },
} as const;

export type SeededE2E = {
  admin: any;
  agency: any;
  mediator: any;
  brand: any;
  shopper: any;
  shopper2: any;
  pgAdmin: any;
  pgAgency: any;
  pgMediator: any;
  pgBrand: any;
  pgShopper: any;
  pgShopper2: any;
};

const E2E_MOBILES = Object.values(E2E_ACCOUNTS).map((a) => a.mobile);

/**
 * Wipe test data before re-seeding.
 *
 * In NODE_ENV=test (vitest / CI) we use a full MongoDB deleteMany + PG TRUNCATE
 * so every test run starts from a clean slate.
 *
 * Outside of test mode (e.g. SEED_E2E from the dev server), we do targeted
 * deletion by E2E mobile numbers so production / backfilled data stays intact.
 */
async function wipeCollections() {
  const isTestEnv =
    String(process.env.NODE_ENV || '').toLowerCase() === 'test' ||
    typeof (globalThis as any).__vitest_worker__ !== 'undefined';

  if (isTestEnv) {
    // ── Full wipe (test mode) ──
    await Promise.allSettled([
      UserModel.deleteMany({}),
      WalletModel.deleteMany({}),
      AgencyModel.deleteMany({}),
      BrandModel.deleteMany({}),
      MediatorProfileModel.deleteMany({}),
      ShopperProfileModel.deleteMany({}),
      CampaignModel.deleteMany({}),
      DealModel.deleteMany({}),
      OrderModel.deleteMany({}),
      TicketModel.deleteMany({}),
      InviteModel.deleteMany({}),
      TransactionModel.deleteMany({}),
      PayoutModel.deleteMany({}),
    ]);

    if (isPrismaAvailable()) {
      const db = prisma();
      try {
        // Prefer TRUNCATE CASCADE for speed — single statement, resets sequences.
        const tables = [
          'audit_logs', 'transactions', 'payouts', 'wallets',
          'order_items', 'orders', 'deals', 'campaigns',
          'invites', 'tickets', 'push_subscriptions', 'suspensions',
          'shopper_profiles', 'mediator_profiles', 'brands', 'agencies',
          'pending_connections', 'system_configs', 'migration_sync', 'users',
        ];
        await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} CASCADE`);
      } catch {
        // Fallback: individual deleteMany in FK-safe order when TRUNCATE fails
        // (e.g. adapter limitations, permission issues, missing tables).
        await db.auditLog.deleteMany({});
        await db.transaction.deleteMany({});
        await db.payout.deleteMany({});
        await db.orderItem.deleteMany({});
        await db.wallet.deleteMany({});
        await db.order.deleteMany({});
        await db.deal.deleteMany({});
        await db.campaign.deleteMany({});
        await db.invite.deleteMany({});
        await db.ticket.deleteMany({});
        await db.pushSubscription.deleteMany({});
        await db.suspension.deleteMany({});
        await db.shopperProfile.deleteMany({});
        await db.mediatorProfile.deleteMany({});
        await db.brand.deleteMany({});
        await db.agency.deleteMany({});
        await db.pendingConnection.deleteMany({});
        await db.systemConfig.deleteMany({});
        await db.migrationSync.deleteMany({});
        await db.user.deleteMany({});
      }
    }
    return;
  }

  // ── Targeted wipe (non-test): only remove E2E accounts ──
  const mongoE2eUsers = await UserModel.find({ mobile: { $in: E2E_MOBILES } });
  const mongoIds = mongoE2eUsers.map((u) => u._id);

  if (mongoIds.length > 0) {
    await Promise.allSettled([
      TransactionModel.deleteMany({}), // E2E-only transactions
      PayoutModel.deleteMany({}),
      OrderModel.deleteMany({ userId: { $in: mongoIds } }),
      DealModel.deleteMany({ createdBy: { $in: mongoIds } }),
      CampaignModel.deleteMany({
        $or: [
          { brandUserId: { $in: mongoIds } },
          { createdBy: { $in: mongoIds } },
        ],
      }),
      WalletModel.deleteMany({ ownerUserId: { $in: mongoIds } }),
      TicketModel.deleteMany({ userId: { $in: mongoIds } }),
      InviteModel.deleteMany({ createdBy: { $in: mongoIds } }),
      MediatorProfileModel.deleteMany({ userId: { $in: mongoIds } }),
      ShopperProfileModel.deleteMany({ userId: { $in: mongoIds } }),
      AgencyModel.deleteMany({ userId: { $in: mongoIds } }),
      BrandModel.deleteMany({ userId: { $in: mongoIds } }),
    ]);
    await UserModel.deleteMany({ mobile: { $in: E2E_MOBILES } });
  }

  // ── PostgreSQL: targeted delete by E2E mobile numbers ──
  if (isPrismaAvailable()) {
    const db = prisma();
    const pgE2eUsers = await db.user.findMany({
      where: { mobile: { in: E2E_MOBILES } },
      select: { id: true },
    });
    const pgIds = pgE2eUsers.map((u) => u.id);

    if (pgIds.length > 0) {
      // Delete non-cascading dependents first (bottom-up from FK graph)
      await db.auditLog.deleteMany({ where: { actorUserId: { in: pgIds } } });
      await db.suspension.deleteMany({
        where: { OR: [{ targetUserId: { in: pgIds } }, { adminUserId: { in: pgIds } }] },
      });
      await db.invite.deleteMany({ where: { createdBy: { in: pgIds } } });
      await db.ticket.deleteMany({ where: { userId: { in: pgIds } } });

      // Wallets & financial records
      const walletIds = (
        await db.wallet.findMany({ where: { ownerUserId: { in: pgIds } }, select: { id: true } })
      ).map((w) => w.id);
      if (walletIds.length) {
        await db.transaction.deleteMany({ where: { walletId: { in: walletIds } } });
        await db.payout.deleteMany({ where: { walletId: { in: walletIds } } });
      }
      await db.wallet.deleteMany({ where: { ownerUserId: { in: pgIds } } });

      // Orders & order items
      const orderIds = (
        await db.order.findMany({ where: { userId: { in: pgIds } }, select: { id: true } })
      ).map((o) => o.id);
      if (orderIds.length) {
        await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      await db.order.deleteMany({ where: { userId: { in: pgIds } } });

      // Campaigns & deals (deals CASCADE from campaign)
      const campaignIds = (
        await db.campaign.findMany({ where: { brandUserId: { in: pgIds } }, select: { id: true } })
      ).map((c) => c.id);
      if (campaignIds.length) {
        await db.deal.deleteMany({ where: { campaignId: { in: campaignIds } } });
      }
      await db.campaign.deleteMany({ where: { brandUserId: { in: pgIds } } });

      // Role documents
      await db.brand.deleteMany({ where: { ownerUserId: { in: pgIds } } });
      await db.agency.deleteMany({ where: { ownerUserId: { in: pgIds } } });

      // Finally delete users (cascades: PendingConnection, MediatorProfile,
      // ShopperProfile, PushSubscription)
      await db.user.deleteMany({ where: { mobile: { in: E2E_MOBILES } } });
    }
  }
}

export async function seedE2E(): Promise<SeededE2E> {
  if (mongoose.connection.readyState === 0) {
    throw new Error('seedE2E() requires an active Mongo connection');
  }

  // Ensure PostgreSQL (Prisma) is connected for controllers that use PG as primary.
  await connectPrisma();

  await wipeCollections();

  const db = prisma();

  const adminPasswordHash = await hashPassword(E2E_ACCOUNTS.admin.password);
  const admin = await UserModel.create({
    name: E2E_ACCOUNTS.admin.name,
    mobile: E2E_ACCOUNTS.admin.mobile,
    username: E2E_ACCOUNTS.admin.username,
    passwordHash: adminPasswordHash,
    role: 'admin',
    roles: ['admin', 'ops'],
    status: 'active',
  });

  // Create corresponding PG user (upsert for idempotency across re-runs)
  const adminUpsertData = {
    mongoId: String(admin._id),
    name: E2E_ACCOUNTS.admin.name,
    mobile: E2E_ACCOUNTS.admin.mobile,
    username: E2E_ACCOUNTS.admin.username,
    passwordHash: adminPasswordHash,
    role: 'admin' as any,
    roles: ['admin', 'ops'] as any,
    status: 'active' as any,
  };
  const pgAdmin = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.admin.mobile },
    create: adminUpsertData,
    update: adminUpsertData,
  });

  const agencyPasswordHash = await hashPassword(E2E_ACCOUNTS.agency.password);
  const agency = await UserModel.create({
    name: E2E_ACCOUNTS.agency.name,
    mobile: E2E_ACCOUNTS.agency.mobile,
    passwordHash: agencyPasswordHash,
    role: 'agency',
    roles: ['agency'],
    status: 'active',

    // For agencies, the system stores the agency code in the legacy `mediatorCode` field.
    mediatorCode: E2E_ACCOUNTS.agency.agencyCode,

    createdBy: admin._id,
  });

  const agencyUpsertData = {
    mongoId: String(agency._id),
    name: E2E_ACCOUNTS.agency.name,
    mobile: E2E_ACCOUNTS.agency.mobile,
    passwordHash: agencyPasswordHash,
    role: 'agency' as any,
    roles: ['agency'] as any,
    status: 'active' as any,
    mediatorCode: E2E_ACCOUNTS.agency.agencyCode,
    createdBy: pgAdmin.id,
  };
  const pgAgency = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.agency.mobile },
    create: agencyUpsertData,
    update: agencyUpsertData,
  });

  const mediatorPasswordHash = await hashPassword(E2E_ACCOUNTS.mediator.password);
  const mediator = await UserModel.create({
    name: E2E_ACCOUNTS.mediator.name,
    mobile: E2E_ACCOUNTS.mediator.mobile,
    passwordHash: mediatorPasswordHash,
    role: 'mediator',
    roles: ['mediator'],
    status: 'active',

    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    parentCode: E2E_ACCOUNTS.agency.agencyCode,

    createdBy: admin._id,
  });

  const mediatorUpsertData = {
    mongoId: String(mediator._id),
    name: E2E_ACCOUNTS.mediator.name,
    mobile: E2E_ACCOUNTS.mediator.mobile,
    passwordHash: mediatorPasswordHash,
    role: 'mediator' as any,
    roles: ['mediator'] as any,
    status: 'active' as any,
    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    parentCode: E2E_ACCOUNTS.agency.agencyCode,
    createdBy: pgAdmin.id,
  };
  const pgMediator = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.mediator.mobile },
    create: mediatorUpsertData,
    update: mediatorUpsertData,
  });

  const brandPasswordHash = await hashPassword(E2E_ACCOUNTS.brand.password);
  const brand = await UserModel.create({
    name: E2E_ACCOUNTS.brand.name,
    mobile: E2E_ACCOUNTS.brand.mobile,
    passwordHash: brandPasswordHash,
    role: 'brand',
    roles: ['brand'],
    status: 'active',

    brandCode: E2E_ACCOUNTS.brand.brandCode,

    createdBy: admin._id,
  });

  const brandUpsertData = {
    mongoId: String(brand._id),
    name: E2E_ACCOUNTS.brand.name,
    mobile: E2E_ACCOUNTS.brand.mobile,
    passwordHash: brandPasswordHash,
    role: 'brand' as any,
    roles: ['brand'] as any,
    status: 'active' as any,
    brandCode: E2E_ACCOUNTS.brand.brandCode,
    createdBy: pgAdmin.id,
  };
  const pgBrand = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.brand.mobile },
    create: brandUpsertData,
    update: brandUpsertData,
  });

  const shopperPasswordHash = await hashPassword(E2E_ACCOUNTS.shopper.password);
  const shopper = await UserModel.create({
    name: E2E_ACCOUNTS.shopper.name,
    mobile: E2E_ACCOUNTS.shopper.mobile,
    passwordHash: shopperPasswordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',

    // Buyer portal is blocked until the shopper is verified by their mediator.
    // E2E flows assume the seeded shoppers can navigate Explore/Orders immediately.
    isVerifiedByMediator: true,

    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,

    createdBy: admin._id,
  });

  const shopperUpsertData = {
    mongoId: String(shopper._id),
    name: E2E_ACCOUNTS.shopper.name,
    mobile: E2E_ACCOUNTS.shopper.mobile,
    passwordHash: shopperPasswordHash,
    role: 'shopper' as any,
    roles: ['shopper'] as any,
    status: 'active' as any,
    isVerifiedByMediator: true,
    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
    createdBy: pgAdmin.id,
  };
  const pgShopper = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper.mobile },
    create: shopperUpsertData,
    update: shopperUpsertData,
  });

  const shopper2PasswordHash = await hashPassword(E2E_ACCOUNTS.shopper2.password);
  const shopper2 = await UserModel.create({
    name: E2E_ACCOUNTS.shopper2.name,
    mobile: E2E_ACCOUNTS.shopper2.mobile,
    passwordHash: shopper2PasswordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',

    isVerifiedByMediator: true,

    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,

    createdBy: admin._id,
  });

  const shopper2UpsertData = {
    mongoId: String(shopper2._id),
    name: E2E_ACCOUNTS.shopper2.name,
    mobile: E2E_ACCOUNTS.shopper2.mobile,
    passwordHash: shopper2PasswordHash,
    role: 'shopper' as any,
    roles: ['shopper'] as any,
    status: 'active' as any,
    isVerifiedByMediator: true,
    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
    createdBy: pgAdmin.id,
  };
  const pgShopper2 = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper2.mobile },
    create: shopper2UpsertData,
    update: shopper2UpsertData,
  });

  // Ensure role documents (Agency/Brand/MediatorProfile/ShopperProfile) exist — pass PG users.
  await ensureRoleDocumentsForUser({ user: pgAgency });
  await ensureRoleDocumentsForUser({ user: pgMediator });
  await ensureRoleDocumentsForUser({ user: pgBrand });
  await ensureRoleDocumentsForUser({ user: pgShopper });
  await ensureRoleDocumentsForUser({ user: pgShopper2 });

  // Pre-fund brand wallet so ops settlement flows can debit it.
  await WalletModel.findOneAndUpdate(
    { ownerUserId: brand._id, deletedAt: null },
    {
      $setOnInsert: {
        ownerUserId: brand._id,
        currency: 'INR',
      },
      $set: {
        availablePaise: 50_000_00, // ₹50,000
        pendingPaise: 0,
        lockedPaise: 0,
        version: 0,
      },
    },
    { upsert: true, new: true }
  );

  // Also create PG wallet for brand with pre-funded balance (upsert for idempotency).
  const walletUpsertData = {
    mongoId: new mongoose.Types.ObjectId().toString(),
    ownerUserId: pgBrand.id,
    currency: 'INR' as any,
    availablePaise: 50_000_00,
    pendingPaise: 0,
    lockedPaise: 0,
    version: 0,
    createdBy: pgAdmin.id,
  };
  await db.wallet.upsert({
    where: { ownerUserId: pgBrand.id },
    create: walletUpsertData,
    update: { availablePaise: 50_000_00, pendingPaise: 0, lockedPaise: 0, version: 0 },
  });

  // Minimal campaign + deal so shoppers can list products and create orders.
  const campaign = await CampaignModel.create({
    title: 'E2E Campaign',
    brandUserId: brand._id,
    brandName: E2E_ACCOUNTS.brand.name,
    platform: 'Amazon',
    image: 'https://placehold.co/600x400',
    productUrl: 'https://example.com/product',
    originalPricePaise: 1200_00,
    pricePaise: 999_00,
    payoutPaise: 100_00,
    returnWindowDays: 14,
    dealType: 'Discount',
    totalSlots: 100,
    usedSlots: 0,
    status: 'active',

    allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
    assignments: {
      [E2E_ACCOUNTS.mediator.mediatorCode]: { limit: 100 },
    },

    createdBy: admin._id,
  });

  // Create PG campaign.
  const pgCampaign = await db.campaign.create({
    data: {
      mongoId: String(campaign._id),
      title: 'E2E Campaign',
      brandUserId: pgBrand.id,
      brandName: E2E_ACCOUNTS.brand.name,
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 1200_00,
      pricePaise: 999_00,
      payoutPaise: 100_00,
      returnWindowDays: 14,
      dealType: 'Discount' as any,
      totalSlots: 100,
      usedSlots: 0,
      status: 'active' as any,
      allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
      assignments: { [E2E_ACCOUNTS.mediator.mediatorCode]: { limit: 100 } },
      createdBy: pgAdmin.id,
    },
  });

  await DealModel.create({
    campaignId: campaign._id,
    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    title: 'E2E Deal',
    description: 'Exclusive',
    image: 'https://placehold.co/600x400',
    productUrl: 'https://example.com/product',
    platform: 'Amazon',
    brandName: E2E_ACCOUNTS.brand.name,
    dealType: 'Discount',
    originalPricePaise: 1200_00,
    pricePaise: 999_00,
    commissionPaise: 50_00,
    payoutPaise: 100_00,
    rating: 5,
    category: 'General',
    active: true,
    createdBy: admin._id,
  });

  // Create PG deal.
  await db.deal.create({
    data: {
      mongoId: new mongoose.Types.ObjectId().toString(),
      campaignId: pgCampaign.id,
      mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
      title: 'E2E Deal',
      description: 'Exclusive',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      platform: 'Amazon',
      brandName: E2E_ACCOUNTS.brand.name,
      dealType: 'Discount' as any,
      originalPricePaise: 1200_00,
      pricePaise: 999_00,
      commissionPaise: 50_00,
      payoutPaise: 100_00,
      rating: 5,
      category: 'General',
      active: true,
      createdBy: pgAdmin.id,
    },
  });

  return {
    admin, agency, mediator, brand, shopper, shopper2,
    pgAdmin, pgAgency, pgMediator, pgBrand, pgShopper, pgShopper2,
  };
}
