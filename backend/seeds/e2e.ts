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
 * Wipe test data before re-seeding.
 *
 * In NODE_ENV=test (vitest / CI) we use a full PG TRUNCATE so every test run
 * starts from a clean slate.
 *
 * Outside of test mode (e.g. SEED_E2E from the dev server), we do targeted
 * deletion by E2E mobile numbers so production data stays intact.
 */
async function wipeCollections() {
  const db = prisma();

  const isTestEnv =
    String(process.env.NODE_ENV || '').toLowerCase() === 'test' ||
    typeof (globalThis as any).__vitest_worker__ !== 'undefined';

  if (isTestEnv) {
    // Try bulk TRUNCATE first (fastest). If the DB user lacks TRUNCATE
    // permission, fall back to per-table deleteMany with best-effort error
    // handling so tests still run even with restricted permissions.
    const truncated = await (async () => {
      try {
        const tables = [
          'audit_logs', 'transactions', 'payouts', 'wallets',
          'order_items', 'orders', 'deals', 'campaigns',
          'invites', 'tickets', 'push_subscriptions', 'suspensions',
          'shopper_profiles', 'mediator_profiles', 'brands', 'agencies',
          'pending_connections', 'system_configs', 'migration_sync', 'users',
        ].map(t => `"${t}"`);
        await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} CASCADE`);
        return true;
      } catch { return false; }
    })();

    if (!truncated) {
      // Best-effort per-table cleanup (order matters for FK constraints)
      const ops: Array<() => Promise<any>> = [
        () => db.auditLog.deleteMany({}),
        () => db.transaction.deleteMany({}),
        () => db.payout.deleteMany({}),
        () => db.orderItem.deleteMany({}),
        () => db.wallet.deleteMany({}),
        () => db.order.deleteMany({}),
        () => db.deal.deleteMany({}),
        () => db.campaign.deleteMany({}),
        () => db.invite.deleteMany({}),
        () => db.ticket.deleteMany({}),
        () => db.pushSubscription.deleteMany({}),
        () => db.suspension.deleteMany({}),
        () => db.shopperProfile.deleteMany({}),
        () => db.mediatorProfile.deleteMany({}),
        () => db.brand.deleteMany({}),
        () => db.agency.deleteMany({}),
        () => db.pendingConnection.deleteMany({}),
        () => db.systemConfig.deleteMany({}),
        () => db.migrationSync.deleteMany({}),
        () => db.user.deleteMany({}),
      ];
      for (const op of ops) {
        try { await op(); } catch { /* skip tables the user lacks permission on */ }
      }
    }
    return;
  }

  // Targeted wipe (non-test): only remove E2E accounts
  const pgE2eUsers = await db.user.findMany({
    where: { mobile: { in: E2E_MOBILES } },
    select: { id: true },
  });
  const pgIds = pgE2eUsers.map((u) => u.id);

  if (pgIds.length > 0) {
    // audit_logs cleanup is best-effort (test user may lack permissions)
    try { await db.auditLog.deleteMany({ where: { actorUserId: { in: pgIds } } }); } catch { /* ignore */ }
    await db.suspension.deleteMany({
      where: { OR: [{ targetUserId: { in: pgIds } }, { adminUserId: { in: pgIds } }] },
    });
    await db.invite.deleteMany({ where: { createdBy: { in: pgIds } } });
    await db.ticket.deleteMany({ where: { userId: { in: pgIds } } });

    const walletIds = (
      await db.wallet.findMany({ where: { ownerUserId: { in: pgIds } }, select: { id: true } })
    ).map((w) => w.id);
    if (walletIds.length) {
      await db.transaction.deleteMany({ where: { walletId: { in: walletIds } } });
      await db.payout.deleteMany({ where: { walletId: { in: walletIds } } });
    }
    await db.wallet.deleteMany({ where: { ownerUserId: { in: pgIds } } });

    const orderIds = (
      await db.order.findMany({ where: { userId: { in: pgIds } }, select: { id: true } })
    ).map((o) => o.id);
    if (orderIds.length) {
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    await db.order.deleteMany({ where: { userId: { in: pgIds } } });

    const campaignIds = (
      await db.campaign.findMany({ where: { brandUserId: { in: pgIds } }, select: { id: true } })
    ).map((c) => c.id);
    if (campaignIds.length) {
      await db.deal.deleteMany({ where: { campaignId: { in: campaignIds } } });
    }
    await db.campaign.deleteMany({ where: { brandUserId: { in: pgIds } } });

    await db.brand.deleteMany({ where: { ownerUserId: { in: pgIds } } });
    await db.agency.deleteMany({ where: { ownerUserId: { in: pgIds } } });
    await db.user.deleteMany({ where: { mobile: { in: E2E_MOBILES } } });
  }
}

export async function seedE2E(): Promise<SeededE2E> {
  await connectPrisma();
  // Wipe is best-effort: if the DB user lacks DELETE/TRUNCATE permissions,
  // we proceed with upserts which only need INSERT + UPDATE.
  try { await wipeCollections(); } catch { /* proceed with upserts */ }

  const db = prisma();

  const adminPasswordHash = await hashPassword(E2E_ACCOUNTS.admin.password);
  const adminUpsertData = {
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
    create: adminUpsertData,
    update: adminUpsertData,
  });

  const agencyPasswordHash = await hashPassword(E2E_ACCOUNTS.agency.password);
  const agencyUpsertData = {
    mongoId: randomUUID(),
    name: E2E_ACCOUNTS.agency.name,
    mobile: E2E_ACCOUNTS.agency.mobile,
    passwordHash: agencyPasswordHash,
    role: 'agency' as any,
    roles: ['agency'] as any,
    status: 'active' as any,
    mediatorCode: E2E_ACCOUNTS.agency.agencyCode,
    createdBy: admin.id,
  };
  const agency = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.agency.mobile },
    create: agencyUpsertData,
    update: agencyUpsertData,
  });

  const mediatorPasswordHash = await hashPassword(E2E_ACCOUNTS.mediator.password);
  const mediatorUpsertData = {
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
  };
  const mediator = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.mediator.mobile },
    create: mediatorUpsertData,
    update: mediatorUpsertData,
  });

  const brandPasswordHash = await hashPassword(E2E_ACCOUNTS.brand.password);
  const brandUpsertData = {
    mongoId: randomUUID(),
    name: E2E_ACCOUNTS.brand.name,
    mobile: E2E_ACCOUNTS.brand.mobile,
    passwordHash: brandPasswordHash,
    role: 'brand' as any,
    roles: ['brand'] as any,
    status: 'active' as any,
    brandCode: E2E_ACCOUNTS.brand.brandCode,
    createdBy: admin.id,
  };
  const brand = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.brand.mobile },
    create: brandUpsertData,
    update: brandUpsertData,
  });

  const shopperPasswordHash = await hashPassword(E2E_ACCOUNTS.shopper.password);
  const shopperUpsertData = {
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
  };
  const shopper = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper.mobile },
    create: shopperUpsertData,
    update: shopperUpsertData,
  });

  const shopper2PasswordHash = await hashPassword(E2E_ACCOUNTS.shopper2.password);
  const shopper2UpsertData = {
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
  };
  const shopper2 = await db.user.upsert({
    where: { mobile: E2E_ACCOUNTS.shopper2.mobile },
    create: shopper2UpsertData,
    update: shopper2UpsertData,
  });

  await ensureRoleDocumentsForUser({ user: agency });
  await ensureRoleDocumentsForUser({ user: mediator });
  await ensureRoleDocumentsForUser({ user: brand });
  await ensureRoleDocumentsForUser({ user: shopper });
  await ensureRoleDocumentsForUser({ user: shopper2 });

  const walletUpsertData = {
    mongoId: randomUUID(),
    ownerUserId: brand.id,
    currency: 'INR' as any,
    availablePaise: 50_000_00,
    pendingPaise: 0,
    lockedPaise: 0,
    version: 0,
    createdBy: admin.id,
  };
  await db.wallet.upsert({
    where: { ownerUserId: brand.id },
    create: walletUpsertData,
    update: { availablePaise: 50_000_00, pendingPaise: 0, lockedPaise: 0, version: 0 },
  });

  const campaign = await db.campaign.create({
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

  return { admin, agency, mediator, brand, shopper, shopper2 };
}
