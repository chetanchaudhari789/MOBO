/**
 * Dual-write service – shadow-writes every Mongo mutation to PostgreSQL via Prisma.
 *
 * Design principles:
 * 1. MongoDB (Mongoose) remains the **primary source of truth**.
 * 2. All PG writes are fire-and-forget; failures are logged, never thrown.
 * 3. Feature-flagged via DUAL_WRITE_ENABLED env var.
 * 4. Idempotent – uses mongoId to upsert so re-runs are safe.
 * 5. Schema mapping handles embedded docs → relational tables.
 *
 * When this is enabled, every service/controller that mutates Mongo should call
 * the corresponding `dualWrite*` helper AFTER the Mongo write succeeds.
 */

import { getPrisma, isPrismaAvailable } from '../database/prisma.js';
import type { PrismaClient } from '../generated/prisma/client.js';

// ─── helpers ────────────────────────────────────────────

function isDualWriteEnabled(): boolean {
  if (!isPrismaAvailable()) return false;
  const flag = process.env.DUAL_WRITE_ENABLED;
  return flag === 'true' || flag === '1';
}

function pg(): PrismaClient | null {
  if (!isDualWriteEnabled()) return null;
  return getPrisma();
}

/**
 * Safe wrapper: runs `fn` and swallows any error, logging it.
 * Dual-writes must never break a Mongo-primary flow.
 */
async function safe(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    console.error(`[dual-write][${label}] PG shadow-write failed:`, err?.message ?? err);
  }
}

/** Convert a Mongoose ObjectId (or string) to string, or null. */
function oid(v: unknown): string | null {
  if (!v) return null;
  return String(v);
}

// ─── User ───────────────────────────────────────────────

export async function dualWriteUser(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('User', async () => {
    // Map roles to enum values
    const roles = (Array.isArray(mongoDoc.roles) ? mongoDoc.roles : [mongoDoc.role || 'shopper'])
      .filter((r: string) => ['shopper', 'mediator', 'agency', 'brand', 'admin', 'ops'].includes(r));

    const data: any = {
      name: String(mongoDoc.name ?? ''),
      username: mongoDoc.username || null,
      mobile: String(mongoDoc.mobile ?? ''),
      email: mongoDoc.email || null,
      passwordHash: String(mongoDoc.passwordHash ?? ''),
      role: mongoDoc.role || 'shopper',
      roles: roles,
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

    // Try upsert by mongoId first.  If a user with the same mobile already
    // exists (e.g. seed data), fall back to updating that record and attaching
    // the mongoId so future upserts hit the fast-path.
    try {
      await db.user.upsert({
        where: { mongoId: id },
        create: { mongoId: id, ...data },
        update: data,
      });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      const isUniqueViolation =
        msg.includes('Unique constraint failed') ||
        msg.includes('unique constraint') ||
        msg.includes('duplicate key');
      if (!isUniqueViolation) throw err;

      // Fallback: find existing user by mobile (or username) and stamp mongoId
      const mobile = String(mongoDoc.mobile ?? '').trim();
      const existing = mobile
        ? await db.user.findFirst({ where: { mobile } })
        : null;
      if (existing) {
        await db.user.update({
          where: { id: existing.id },
          data: { mongoId: id, ...data },
        });
      } else {
        // Try by username if mobile didn't match
        const uname = mongoDoc.username || null;
        const byName = uname
          ? await db.user.findFirst({ where: { username: uname } })
          : null;
        if (byName) {
          await db.user.update({
            where: { id: byName.id },
            data: { mongoId: id, ...data },
          });
        } else {
          throw err; // re-throw if we can't resolve the conflict
        }
      }
    }

    // Sync pending connections (embedded array → relational table)
    if (Array.isArray(mongoDoc.pendingConnections) && mongoDoc.pendingConnections.length > 0) {
      const pgUser = await db.user.findUnique({ where: { mongoId: id }, select: { id: true } });
      if (pgUser) {
        // Remove old connections and re-insert
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
  });
}

// ─── Brand ──────────────────────────────────────────────

export async function dualWriteBrand(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Brand', async () => {
    // Resolve ownerUserId → PG UUID
    const ownerPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.ownerUserId)! },
      select: { id: true },
    });
    if (!ownerPg) return; // owner not yet synced

    const data: any = {
      name: String(mongoDoc.name ?? ''),
      brandCode: String(mongoDoc.brandCode ?? ''),
      ownerUserId: ownerPg.id,
      connectedAgencyCodes: Array.isArray(mongoDoc.connectedAgencyCodes) ? mongoDoc.connectedAgencyCodes : [],
      status: mongoDoc.status || 'active',
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.brand.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Agency ─────────────────────────────────────────────

export async function dualWriteAgency(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Agency', async () => {
    const ownerPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.ownerUserId)! },
      select: { id: true },
    });
    if (!ownerPg) return;

    const data: any = {
      name: String(mongoDoc.name ?? ''),
      agencyCode: String(mongoDoc.agencyCode ?? ''),
      ownerUserId: ownerPg.id,
      status: mongoDoc.status || 'active',
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.agency.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── MediatorProfile ────────────────────────────────────

export async function dualWriteMediatorProfile(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('MediatorProfile', async () => {
    const userPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.userId)! },
      select: { id: true },
    });
    if (!userPg) return;

    const data: any = {
      userId: userPg.id,
      mediatorCode: String(mongoDoc.mediatorCode ?? ''),
      parentAgencyCode: mongoDoc.parentAgencyCode || null,
      status: mongoDoc.status || 'active',
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.mediatorProfile.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── ShopperProfile ─────────────────────────────────────

export async function dualWriteShopperProfile(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('ShopperProfile', async () => {
    const userPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.userId)! },
      select: { id: true },
    });
    if (!userPg) return;

    const data: any = {
      userId: userPg.id,
      defaultMediatorCode: mongoDoc.defaultMediatorCode || null,
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.shopperProfile.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Campaign ───────────────────────────────────────────

export async function dualWriteCampaign(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Campaign', async () => {
    const brandUserPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.brandUserId)! },
      select: { id: true },
    });
    if (!brandUserPg) return;

    // Convert Mongoose Map → plain object for JSONB
    let assignments: Record<string, any> = {};
    if (mongoDoc.assignments) {
      if (typeof mongoDoc.assignments.toJSON === 'function') {
        assignments = mongoDoc.assignments.toJSON();
      } else if (mongoDoc.assignments instanceof Map) {
        mongoDoc.assignments.forEach((v: any, k: string) => { assignments[k] = v; });
      } else {
        assignments = mongoDoc.assignments;
      }
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

    await db.campaign.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Deal ───────────────────────────────────────────────

export async function dualWriteDeal(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Deal', async () => {
    const campaignPg = await db.campaign.findUnique({
      where: { mongoId: oid(mongoDoc.campaignId)! },
      select: { id: true },
    });
    if (!campaignPg) return;

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

    await db.deal.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Order (complex: items, events, screenshots) ────────

export async function dualWriteOrder(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Order', async () => {
    const userPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.userId)! },
      select: { id: true },
    });
    if (!userPg) return;

    let brandUserPgId: string | null = null;
    if (mongoDoc.brandUserId) {
      const brandPg = await db.user.findUnique({
        where: { mongoId: oid(mongoDoc.brandUserId)! },
        select: { id: true },
      });
      brandUserPgId = brandPg?.id ?? null;
    }

    const validWorkflowStatuses = ['CREATED','REDIRECTED','ORDERED','PROOF_SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','REWARD_PENDING','COMPLETED','FAILED'];
    const workflowStatus = validWorkflowStatuses.includes(mongoDoc.workflowStatus) ? mongoDoc.workflowStatus : 'CREATED';

    const validOrderStatuses = ['Ordered','Shipped','Delivered','Cancelled','Returned'];
    const status = validOrderStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'Ordered';

    const validPaymentStatuses = ['Pending','Paid','Refunded','Failed'];
    const paymentStatus = validPaymentStatuses.includes(mongoDoc.paymentStatus) ? mongoDoc.paymentStatus : 'Pending';

    const validAffiliateStatuses = ['Unchecked','Pending_Cooling','Approved_Settled','Rejected','Fraud_Alert','Cap_Exceeded','Frozen_Disputed'];
    const affiliateStatus = validAffiliateStatuses.includes(mongoDoc.affiliateStatus) ? mongoDoc.affiliateStatus : 'Unchecked';

    const validRejectionTypes = ['order','review','rating','returnWindow'];
    const rejectionType = mongoDoc.rejection?.type && validRejectionTypes.includes(mongoDoc.rejection.type)
      ? mongoDoc.rejection.type : null;

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

    const pgOrder = await db.order.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });

    // Sync order items (embedded array → relational table)
    if (Array.isArray(mongoDoc.items) && mongoDoc.items.length > 0) {
      await db.orderItem.deleteMany({ where: { orderId: pgOrder.id } });

      // Resolve campaign IDs
      const itemData = [];
      for (const item of mongoDoc.items) {
        const campPg = await db.campaign.findUnique({
          where: { mongoId: oid(item.campaignId)! },
          select: { id: true },
        });
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
      if (itemData.length > 0) {
        await db.orderItem.createMany({ data: itemData });
      }
    }
  });
}

// ─── Wallet ─────────────────────────────────────────────

export async function dualWriteWallet(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Wallet', async () => {
    const ownerPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.ownerUserId)! },
      select: { id: true },
    });
    if (!ownerPg) return;

    const data: any = {
      ownerUserId: ownerPg.id,
      currency: 'INR',
      availablePaise: mongoDoc.availablePaise ?? 0,
      pendingPaise: mongoDoc.pendingPaise ?? 0,
      lockedPaise: mongoDoc.lockedPaise ?? 0,
      version: mongoDoc.version ?? 0,
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.wallet.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Transaction ────────────────────────────────────────

export async function dualWriteTransaction(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Transaction', async () => {
    // Resolve wallet ID if present
    let walletPgId: string | null = null;
    if (mongoDoc.walletId) {
      const wPg = await db.wallet.findUnique({
        where: { mongoId: oid(mongoDoc.walletId)! },
        select: { id: true },
      });
      walletPgId = wPg?.id ?? null;
    }

    const validTypes = ['brand_deposit','platform_fee','commission_lock','commission_settle','cashback_lock','cashback_settle','order_settlement_debit','commission_reversal','margin_reversal','agency_payout','agency_receipt','payout_request','payout_complete','payout_failed','refund'];
    const type = validTypes.includes(mongoDoc.type) ? mongoDoc.type : 'brand_deposit';

    const validStatuses = ['pending','completed','failed','reversed'];
    const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'pending';

    const data: any = {
      idempotencyKey: String(mongoDoc.idempotencyKey ?? ''),
      type,
      status,
      amountPaise: mongoDoc.amountPaise ?? 0,
      currency: mongoDoc.currency || 'INR',
      orderId: mongoDoc.orderId || null,
      walletId: walletPgId,
      metadata: mongoDoc.metadata ?? null,
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.transaction.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Payout ─────────────────────────────────────────────

export async function dualWritePayout(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Payout', async () => {
    const benPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.beneficiaryUserId)! },
      select: { id: true },
    });
    if (!benPg) return;

    const walletPg = await db.wallet.findUnique({
      where: { mongoId: oid(mongoDoc.walletId)! },
      select: { id: true },
    });
    if (!walletPg) return;

    const validStatuses = ['requested','processing','paid','failed','canceled','recorded'];
    const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'requested';

    const data: any = {
      beneficiaryUserId: benPg.id,
      walletId: walletPg.id,
      amountPaise: mongoDoc.amountPaise ?? 0,
      currency: mongoDoc.currency || 'INR',
      status,
      provider: mongoDoc.provider || null,
      providerRef: mongoDoc.providerRef || null,
      failureCode: mongoDoc.failureCode || null,
      failureMessage: mongoDoc.failureMessage || null,
      requestedAt: mongoDoc.requestedAt || new Date(),
      processedAt: mongoDoc.processedAt || null,
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.payout.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Invite ─────────────────────────────────────────────

export async function dualWriteInvite(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Invite', async () => {
    const validRoles = ['shopper','mediator','agency','brand','admin','ops'];
    const role = validRoles.includes(mongoDoc.role) ? mongoDoc.role : 'shopper';
    const validStatuses = ['active','used','revoked','expired'];
    const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'active';

    // Resolve createdBy → PG UUID if present
    let createdByPgId: string | null = null;
    if (mongoDoc.createdBy) {
      const cbPg = await db.user.findUnique({
        where: { mongoId: oid(mongoDoc.createdBy)! },
        select: { id: true },
      });
      createdByPgId = cbPg?.id ?? null;
    }

    const data: any = {
      code: String(mongoDoc.code ?? ''),
      role,
      label: mongoDoc.label || null,
      parentCode: mongoDoc.parentCode || null,
      status,
      maxUses: mongoDoc.maxUses ?? 1,
      useCount: mongoDoc.useCount ?? 0,
      expiresAt: mongoDoc.expiresAt || null,
      createdBy: createdByPgId,
      usedAt: mongoDoc.usedAt || null,
      uses: Array.isArray(mongoDoc.uses) ? mongoDoc.uses : [],
      revokedAt: mongoDoc.revokedAt || null,
    };

    await db.invite.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Ticket ─────────────────────────────────────────────

export async function dualWriteTicket(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Ticket', async () => {
    const userPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.userId)! },
      select: { id: true },
    });
    if (!userPg) return;

    const validStatuses = ['Open','Resolved','Rejected'];
    const status = validStatuses.includes(mongoDoc.status) ? mongoDoc.status : 'Open';

    const data: any = {
      userId: userPg.id,
      userName: String(mongoDoc.userName ?? ''),
      role: String(mongoDoc.role ?? ''),
      orderId: mongoDoc.orderId || null,
      issueType: String(mongoDoc.issueType ?? ''),
      description: String(mongoDoc.description ?? ''),
      status,
      resolutionNote: mongoDoc.resolutionNote || null,
      resolvedAt: mongoDoc.resolvedAt || null,
      deletedAt: mongoDoc.deletedAt || null,
    };

    await db.ticket.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── PushSubscription ───────────────────────────────────

export async function dualWritePushSubscription(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('PushSubscription', async () => {
    const userPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.userId)! },
      select: { id: true },
    });
    if (!userPg) return;

    const validApps = ['buyer', 'mediator'];
    const app = validApps.includes(mongoDoc.app) ? mongoDoc.app : 'buyer';

    const data: any = {
      userId: userPg.id,
      app,
      endpoint: String(mongoDoc.endpoint ?? ''),
      expirationTime: mongoDoc.expirationTime ?? null,
      keysP256dh: String(mongoDoc.keys?.p256dh ?? ''),
      keysAuth: String(mongoDoc.keys?.auth ?? ''),
      userAgent: mongoDoc.userAgent || null,
    };

    await db.pushSubscription.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── Suspension ─────────────────────────────────────────

export async function dualWriteSuspension(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('Suspension', async () => {
    const targetPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.targetUserId)! },
      select: { id: true },
    });
    if (!targetPg) return;

    const adminPg = await db.user.findUnique({
      where: { mongoId: oid(mongoDoc.adminUserId)! },
      select: { id: true },
    });
    if (!adminPg) return;

    const validActions = ['suspend', 'unsuspend'];
    const action = validActions.includes(mongoDoc.action) ? mongoDoc.action : 'suspend';

    const data: any = {
      targetUserId: targetPg.id,
      action,
      reason: mongoDoc.reason || null,
      adminUserId: adminPg.id,
    };

    await db.suspension.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── AuditLog ───────────────────────────────────────────

export async function dualWriteAuditLog(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('AuditLog', async () => {
    // Try to resolve actor user, but it's optional
    let actorPgId: string | null = null;
    if (mongoDoc.actorUserId) {
      const actorPg = await db.user.findUnique({
        where: { mongoId: oid(mongoDoc.actorUserId)! },
        select: { id: true },
      });
      actorPgId = actorPg?.id ?? null;
    }

    const data: any = {
      actorUserId: actorPgId,
      actorRoles: Array.isArray(mongoDoc.actorRoles) ? mongoDoc.actorRoles : [],
      action: String(mongoDoc.action ?? ''),
      entityType: mongoDoc.entityType || null,
      entityId: mongoDoc.entityId || null,
      ip: mongoDoc.ip || null,
      userAgent: mongoDoc.userAgent || null,
      metadata: mongoDoc.metadata ?? null,
    };

    await db.auditLog.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}

// ─── SystemConfig ───────────────────────────────────────

export async function dualWriteSystemConfig(mongoDoc: any): Promise<void> {
  const db = pg();
  if (!db) return;
  const id = oid(mongoDoc._id);
  if (!id) return;

  await safe('SystemConfig', async () => {
    const data: any = {
      key: mongoDoc.key || 'system',
      adminContactEmail: mongoDoc.adminContactEmail || null,
    };

    await db.systemConfig.upsert({
      where: { mongoId: id },
      create: { mongoId: id, ...data },
      update: data,
    });
  });
}
