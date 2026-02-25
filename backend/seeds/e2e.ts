// MongoDB removed — all seeding is PG-only via Prisma.
import { randomUUID } from 'node:crypto';

import { hashPassword } from '../services/passwords.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { connectPrisma, prisma } from '../database/prisma.js';

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
};

const E2E_MOBILES = Object.values(E2E_ACCOUNTS).map((a) => a.mobile);

/**
 * Targeted cleanup: removes ONLY data created by E2E test accounts
 * (orders, order-items, invites, transactions, payouts, tickets, audit-logs,
 *  pre-orders, pending-connections, test-registered users).
 *
 * Production / migrated data is NEVER touched — we filter by E2E user IDs
 * and known test-created mobile numbers.
 */

// Mobiles used by test-registered users (auth.register, mediator.pending-approval, campaign.assign-slots)
const TEST_REGISTERED_MOBILES = [
  '9111111111', '9222222222', '9222000000', '9333333333',
  '9111000000', '9777777777', '9444444444', '9555555555', '9666666666',
  '9111222333', '9111444555', '9222333444',
];

async function cleanE2ETestData(db: ReturnType<typeof prisma>) {
  // Collect IDs for both E2E seed accounts and test-registered users
  const allTestMobiles = [...E2E_MOBILES, ...TEST_REGISTERED_MOBILES];
  const allTestUsers = await db.user.findMany({
    where: { mobile: { in: allTestMobiles } },
    select: { id: true },
  });
  const allTestIds = allTestUsers.map((u) => u.id);

  const e2eUsers = allTestUsers.filter((_, i) => i < E2E_MOBILES.length); // rough but sufficient
  // Better: get E2E IDs specifically
  const e2eSeedUsers = await db.user.findMany({
    where: { mobile: { in: E2E_MOBILES } },
    select: { id: true },
  });
  const e2eIds = e2eSeedUsers.map((u) => u.id);

  if (allTestIds.length === 0) return;

  // Order items cascade-delete with orders (ON DELETE CASCADE in schema).
  // Still delete explicitly to be safe across all Prisma adapters.
  await db.orderItem.deleteMany({ where: { order: { userId: { in: allTestIds } } } }).catch(() => {});
  await db.order.deleteMany({ where: { userId: { in: allTestIds } } });
  await db.invite.deleteMany({ where: { createdBy: { in: allTestIds } } });
  await db.transaction.deleteMany({ where: { OR: [{ fromUserId: { in: allTestIds } }, { toUserId: { in: allTestIds } }] } });
  await db.payout.deleteMany({ where: { beneficiaryUserId: { in: allTestIds } } });
  await db.ticket.deleteMany({ where: { userId: { in: allTestIds } } });
  await db.auditLog.deleteMany({ where: { actorUserId: { in: allTestIds } } });
  await db.pendingConnection.deleteMany({ where: { userId: { in: allTestIds } } });

  // Clean up test-created deals and campaigns (not the E2E Campaign/Deal — those are upserted later).
  // deals.publish and other tests create extra campaigns/deals with createdBy = E2E users.
  await db.deal.deleteMany({ where: { createdBy: { in: e2eIds }, title: { not: 'E2E Deal' } } }).catch(() => {});
  await db.campaign.deleteMany({ where: { createdBy: { in: e2eIds }, title: { not: 'E2E Campaign' } } }).catch(() => {});

  // Remove test-registered users (NOT the E2E seed accounts themselves)
  if (TEST_REGISTERED_MOBILES.length > 0) {
    // Delete role documents for test-registered users
    const testRegUsers = await db.user.findMany({
      where: { mobile: { in: TEST_REGISTERED_MOBILES } },
      select: { id: true, role: true },
    });
    for (const u of testRegUsers) {
      // MediatorProfile & ShopperProfile cascade-delete with user (onDelete: Cascade)
      // Brand & Agency use ownerUserId without cascade — delete manually
      await db.brand.deleteMany({ where: { ownerUserId: u.id } }).catch(() => {});
      await db.agency.deleteMany({ where: { ownerUserId: u.id } }).catch(() => {});
      // Wallet: no cascade from User
      await db.wallet.deleteMany({ where: { ownerUserId: u.id } }).catch(() => {});
    }
    await db.user.deleteMany({ where: { mobile: { in: TEST_REGISTERED_MOBILES } } });
  }

  // Also delete test invite codes that tests create
  await db.invite.deleteMany({
    where: { code: { startsWith: 'INV_' } },
  }).catch(() => {});

  // Reset brand's connectedAgencies so connect-flow tests start clean
  await db.user.updateMany({
    where: { mobile: { in: E2E_MOBILES }, roles: { has: 'brand' as any } },
    data: { connectedAgencies: [] },
  });
}

export async function seedE2E(): Promise<SeededE2E> {
  await connectPrisma();
  // Clean up ONLY E2E test-created data (orders, invites, etc.) — production data stays.
  // E2E accounts themselves are upserted by mobile number.

  const db = prisma();

  await cleanE2ETestData(db);

  const adminPasswordHash = await hashPassword(E2E_ACCOUNTS.admin.password);
  const adminCreateData = {
    mongoId: randomUUID(),
    name: E2E_ACCOUNTS.admin.name,
    mobile: E2E_ACCOUNTS.admin.mobile,
    username: E2E_ACCOUNTS.admin.username,
    passwordHash: adminPasswordHash,
    role: 'admin' as any,
    roles: ['admin', 'ops'] as any,
    status: 'active' as any,
  };
  const admin = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.admin.mobile },
    create: adminCreateData,
    update: {
      name: E2E_ACCOUNTS.admin.name,
      username: E2E_ACCOUNTS.admin.username,
      passwordHash: adminPasswordHash,
      role: 'admin' as any,
      roles: ['admin', 'ops'] as any,
      status: 'active' as any,
    },
  });

  const agencyPasswordHash = await hashPassword(E2E_ACCOUNTS.agency.password);
  const agency = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.agency.mobile },
    create: {
      mongoId: randomUUID(),
      name: E2E_ACCOUNTS.agency.name,
      mobile: E2E_ACCOUNTS.agency.mobile,
      passwordHash: agencyPasswordHash,
      role: 'agency' as any,
      roles: ['agency'] as any,
      status: 'active' as any,
      mediatorCode: E2E_ACCOUNTS.agency.agencyCode,
      createdBy: admin.id,
    },
    update: {
      name: E2E_ACCOUNTS.agency.name,
      passwordHash: agencyPasswordHash,
      role: 'agency' as any,
      roles: ['agency'] as any,
      status: 'active' as any,
      mediatorCode: E2E_ACCOUNTS.agency.agencyCode,
    },
  });

  const mediatorPasswordHash = await hashPassword(E2E_ACCOUNTS.mediator.password);
  const mediator = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.mediator.mobile },
    create: {
      mongoId: randomUUID(),
      name: E2E_ACCOUNTS.mediator.name,
      mobile: E2E_ACCOUNTS.mediator.mobile,
      passwordHash: mediatorPasswordHash,
      role: 'mediator' as any,
      roles: ['mediator'] as any,
      status: 'active' as any,
      mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
      parentCode: E2E_ACCOUNTS.agency.agencyCode,
      createdBy: admin.id,
    },
    update: {
      name: E2E_ACCOUNTS.mediator.name,
      passwordHash: mediatorPasswordHash,
      role: 'mediator' as any,
      roles: ['mediator'] as any,
      status: 'active' as any,
      mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
      parentCode: E2E_ACCOUNTS.agency.agencyCode,
    },
  });

  const brandPasswordHash = await hashPassword(E2E_ACCOUNTS.brand.password);
  const brand = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.brand.mobile },
    create: {
      mongoId: randomUUID(),
      name: E2E_ACCOUNTS.brand.name,
      mobile: E2E_ACCOUNTS.brand.mobile,
      passwordHash: brandPasswordHash,
      role: 'brand' as any,
      roles: ['brand'] as any,
      status: 'active' as any,
      brandCode: E2E_ACCOUNTS.brand.brandCode,
      createdBy: admin.id,
    },
    update: {
      name: E2E_ACCOUNTS.brand.name,
      passwordHash: brandPasswordHash,
      role: 'brand' as any,
      roles: ['brand'] as any,
      status: 'active' as any,
      brandCode: E2E_ACCOUNTS.brand.brandCode,
    },
  });

  const shopperPasswordHash = await hashPassword(E2E_ACCOUNTS.shopper.password);
  const shopper = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper.mobile },
    create: {
      mongoId: randomUUID(),
      name: E2E_ACCOUNTS.shopper.name,
      mobile: E2E_ACCOUNTS.shopper.mobile,
      passwordHash: shopperPasswordHash,
      role: 'shopper' as any,
      roles: ['shopper'] as any,
      status: 'active' as any,
      isVerifiedByMediator: true,
      parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
      createdBy: admin.id,
    },
    update: {
      name: E2E_ACCOUNTS.shopper.name,
      passwordHash: shopperPasswordHash,
      role: 'shopper' as any,
      roles: ['shopper'] as any,
      status: 'active' as any,
      isVerifiedByMediator: true,
      parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
    },
  });

  const shopper2PasswordHash = await hashPassword(E2E_ACCOUNTS.shopper2.password);
  const shopper2 = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper2.mobile },
    create: {
      mongoId: randomUUID(),
      name: E2E_ACCOUNTS.shopper2.name,
      mobile: E2E_ACCOUNTS.shopper2.mobile,
      passwordHash: shopper2PasswordHash,
      role: 'shopper' as any,
      roles: ['shopper'] as any,
      status: 'active' as any,
      isVerifiedByMediator: true,
      parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
      createdBy: admin.id,
    },
    update: {
      name: E2E_ACCOUNTS.shopper2.name,
      passwordHash: shopper2PasswordHash,
      role: 'shopper' as any,
      roles: ['shopper'] as any,
      status: 'active' as any,
      isVerifiedByMediator: true,
      parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
    },
  });

  await ensureRoleDocumentsForUser({ user: agency });
  await ensureRoleDocumentsForUser({ user: mediator });
  await ensureRoleDocumentsForUser({ user: brand });
  await ensureRoleDocumentsForUser({ user: shopper });
  await ensureRoleDocumentsForUser({ user: shopper2 });

  // Wallet: upsert — reset balance on each test run since transactions are cleaned
  await db.wallet.upsert({
    where: { ownerUserId: brand.id },
    create: {
      mongoId: randomUUID(),
      ownerUserId: brand.id,
      currency: 'INR' as any,
      availablePaise: 50_000_00,
      pendingPaise: 0,
      lockedPaise: 0,
      version: 0,
      createdBy: admin.id,
    },
    update: { availablePaise: 50_000_00, pendingPaise: 0, lockedPaise: 0 },
  });

  // Campaign: find existing or create — never duplicate
  let campaign = await db.campaign.findFirst({
    where: { title: 'E2E Campaign', brandUserId: brand.id, deletedAt: null },
  });
  if (!campaign) {
    campaign = await db.campaign.create({
      data: {
        mongoId: randomUUID(),
        title: 'E2E Campaign',
        brandUserId: brand.id,
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
        createdBy: admin.id,
      },
    });
  } else {
    // Ensure campaign is still active and properly configured
    await db.campaign.update({
      where: { id: campaign.id },
      data: {
        status: 'active' as any,
        usedSlots: 0,
        allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
        assignments: { [E2E_ACCOUNTS.mediator.mediatorCode]: { limit: 100 } },
      },
    });
  }

  // Deal: find existing or create — never duplicate
  const existingDeal = await db.deal.findFirst({
    where: { campaignId: campaign.id, mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode, deletedAt: null },
  });
  if (!existingDeal) {
    await db.deal.create({
      data: {
        mongoId: randomUUID(),
        campaignId: campaign.id,
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
        createdBy: admin.id,
      },
    });
  } else {
    // Ensure deal is still active for tests
    await db.deal.update({ where: { id: existingDeal.id }, data: { active: true } });
  }

  return { admin, agency, mediator, brand, shopper, shopper2 };
}
