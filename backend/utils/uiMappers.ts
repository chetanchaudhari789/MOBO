import type { HydratedDocument } from 'mongoose';
import type { UserDoc } from '../models/User.js';
import type { CampaignDoc } from '../models/Campaign.js';
import type { WalletDoc } from '../models/Wallet.js';
import type { OrderDoc } from '../models/Order.js';
import type { DealDoc } from '../models/Deal.js';
import type { TicketDoc } from '../models/Ticket.js';
import { paiseToRupees } from './money.js';

export function toUiRole(role: string): 'user' | 'agency' | 'mediator' | 'brand' | 'admin' {
  if (role === 'shopper') return 'user';
  if (role === 'ops') return 'admin';
  if (role === 'agency') return 'agency';
  if (role === 'mediator') return 'mediator';
  if (role === 'brand') return 'brand';
  if (role === 'admin') return 'admin';
  return 'user';
}

export function toUiUser(
  user: HydratedDocument<UserDoc> | (UserDoc & { _id?: any }) | any,
  wallet?: WalletDoc | null
) {
  const walletBalancePaise = wallet?.availablePaise ?? user.walletBalancePaise ?? 0;
  const walletPendingPaise = wallet?.pendingPaise ?? user.walletPendingPaise ?? 0;

  const role = toUiRole(String(user.role));

  return {
    id: String(user._id ?? user.id),
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    role,
    status: user.status,

    mediatorCode: role === 'user' ? user.parentCode : user.mediatorCode,
    parentCode: role === 'user' ? undefined : user.parentCode,
    generatedCodes: user.generatedCodes ?? [],

    brandCode: user.brandCode,
    connectedAgencies: user.connectedAgencies ?? [],
    pendingConnections: (user.pendingConnections ?? []).map((p: any) => ({
      agencyId: p.agencyId,
      agencyName: p.agencyName,
      agencyCode: p.agencyCode,
      timestamp: p.timestamp ? new Date(p.timestamp).toISOString() : new Date().toISOString(),
    })),

    kycStatus: user.kycStatus,
    kycDocuments: user.kycDocuments,

    isVerifiedByMediator: user.isVerifiedByMediator,

    upiId: user.upiId,
    qrCode: user.qrCode,
    bankDetails: user.bankDetails,

    walletBalance: paiseToRupees(walletBalancePaise),
    walletPending: paiseToRupees(walletPendingPaise),

    avatar: user.avatar,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  };
}

export function toUiCampaign(c: CampaignDoc & { _id?: any } | any) {
  const statusMap: Record<string, 'Active' | 'Paused' | 'Completed' | 'Draft'> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    draft: 'Draft',
  };

  const assignmentsObj =
    c.assignments instanceof Map ? Object.fromEntries(c.assignments) : c.assignments;

  // UI expects assignments as "slots per code" (number). The DB schema supports
  // { limit, payout? } objects; normalize those objects down to their limit.
  const assignments: Record<string, number> = {};
  if (assignmentsObj && typeof assignmentsObj === 'object') {
    for (const [code, raw] of Object.entries(assignmentsObj)) {
      if (typeof raw === 'number') {
        assignments[code] = raw;
        continue;
      }
      if (raw && typeof raw === 'object' && typeof (raw as any).limit === 'number') {
        assignments[code] = (raw as any).limit;
        continue;
      }
      assignments[code] = 0;
    }
  }

  return {
    id: String(c._id ?? c.id),
    title: c.title,
    brand: c.brandName,
    brandId: String(c.brandUserId ?? c.brandId ?? ''),
    platform: c.platform,
    price: paiseToRupees(c.pricePaise),
    originalPrice: paiseToRupees(c.originalPricePaise),
    payout: paiseToRupees(c.payoutPaise),
    image: c.image,
    productUrl: c.productUrl,
    totalSlots: c.totalSlots ?? 0,
    usedSlots: c.usedSlots ?? 0,
    status: statusMap[String(c.status)] ?? 'Draft',
    assignments,
    allowedAgencies: c.allowedAgencyCodes ?? c.allowedAgencies ?? [],
    createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
    returnWindowDays: c.returnWindowDays,
    dealType: c.dealType,
  };
}

export function toUiDeal(d: DealDoc & { _id?: any } | any) {
  const placeholderImage =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
        '<rect width="160" height="160" rx="24" fill="#F3F4F6"/>' +
        '<circle cx="80" cy="64" r="24" fill="#E5E7EB"/>' +
        '<rect x="32" y="104" width="96" height="16" rx="8" fill="#E5E7EB"/>' +
      '</svg>'
    );
  const safeText = (value: unknown) => String(value || '').replace(/["\\]/g, '').trim();
  const image = safeText(d.image) || placeholderImage;

  return {
    id: String(d._id ?? d.id),
    title: safeText(d.title),
    description: safeText(d.description) || 'Exclusive',
    price: paiseToRupees(d.pricePaise),
    originalPrice: paiseToRupees(d.originalPricePaise),
    commission: paiseToRupees(d.commissionPaise),
    image,
    productUrl: safeText(d.productUrl),
    rating: d.rating ?? 5,
    category: safeText(d.category) || 'General',
    platform: safeText(d.platform),
    dealType: safeText(d.dealType),
    brandName: safeText(d.brandName),
    mediatorCode: safeText(d.mediatorCode),
    campaignId: String(d.campaignId),
    active: !!d.active,
    inventoryCount: d.inventoryCount,
  };
}

export function toUiOrder(o: OrderDoc & { _id?: any } | any) {
  const dealTypes = (o.items ?? []).map((it: any) => String(it?.dealType || '')).filter(Boolean);
  const requiresReview = dealTypes.includes('Review');
  const requiresRating = dealTypes.includes('Rating');

  const hasReviewProof = !!(o.reviewLink || o.screenshots?.review);
  const hasRatingProof = !!o.screenshots?.rating;

  const orderVerifiedAt = o.verification?.order?.verifiedAt ? new Date(o.verification.order.verifiedAt) : null;
  const reviewVerifiedAt = o.verification?.review?.verifiedAt ? new Date(o.verification.review.verifiedAt) : null;
  const ratingVerifiedAt = o.verification?.rating?.verifiedAt ? new Date(o.verification.rating.verifiedAt) : null;

  const requiredSteps: Array<'review' | 'rating'> = [
    ...(requiresReview ? (['review'] as const) : []),
    ...(requiresRating ? (['rating'] as const) : []),
  ];

  const missingProofs: Array<'review' | 'rating'> = [
    ...(requiresReview && !hasReviewProof ? (['review'] as const) : []),
    ...(requiresRating && !hasRatingProof ? (['rating'] as const) : []),
  ];

  const missingVerifications: Array<'review' | 'rating'> = [
    ...(requiresReview && !reviewVerifiedAt ? (['review'] as const) : []),
    ...(requiresRating && !ratingVerifiedAt ? (['rating'] as const) : []),
  ];
  return {
    id: String(o._id ?? o.id),
    userId: String(o.userId),
    items: (o.items ?? []).map((it: any) => ({
      productId: it.productId,
      title: it.title,
      image: it.image,
      priceAtPurchase: paiseToRupees(it.priceAtPurchasePaise),
      commission: paiseToRupees(it.commissionPaise),
      campaignId: String(it.campaignId),
      dealType: it.dealType,
      quantity: it.quantity,
      platform: it.platform,
      brandName: it.brandName,
    })),
    total: paiseToRupees(o.totalPaise),
    status: o.status,
    workflowStatus: o.workflowStatus,
    frozen: !!o.frozen,
    frozenAt: o.frozenAt ? new Date(o.frozenAt).toISOString() : undefined,
    frozenReason: o.frozenReason,
    paymentStatus: o.paymentStatus,
    affiliateStatus: o.affiliateStatus,
    externalOrderId: o.externalOrderId,
    settlementRef: (o as any).settlementRef,
    screenshots: o.screenshots ?? {},
    reviewLink: o.reviewLink,
    rejection: o.rejection
      ? {
          type: o.rejection.type,
          reason: o.rejection.reason,
          rejectedAt: o.rejection.rejectedAt
            ? new Date(o.rejection.rejectedAt).toISOString()
            : undefined,
          rejectedBy: o.rejection.rejectedBy ? String(o.rejection.rejectedBy) : undefined,
        }
      : undefined,
    verification: {
      orderVerified: !!orderVerifiedAt,
      orderVerifiedAt: orderVerifiedAt ? orderVerifiedAt.toISOString() : undefined,
      reviewVerified: !!reviewVerifiedAt,
      reviewVerifiedAt: reviewVerifiedAt ? reviewVerifiedAt.toISOString() : undefined,
      ratingVerified: !!ratingVerifiedAt,
      ratingVerifiedAt: ratingVerifiedAt ? ratingVerifiedAt.toISOString() : undefined,
    },
    requirements: {
      required: requiredSteps,
      missingProofs,
      missingVerifications,
    },
    managerName: o.managerName,
    agencyName: o.agencyName,
    buyerName: o.buyerName,
    buyerMobile: o.buyerMobile,
    brandName: o.brandName,
    createdAt: new Date(o.createdAt ?? o.createdAtIso ?? Date.now()).toISOString(),
    expectedSettlementDate: o.expectedSettlementDate
      ? new Date(o.expectedSettlementDate).toISOString()
      : undefined,
  };
}

// Brand must never receive buyer PII or raw proof artifacts.
export function toUiOrderForBrand(o: OrderDoc & { _id?: any } | any) {
  const dealTypes = (o.items ?? []).map((it: any) => String(it?.dealType || '')).filter(Boolean);
  const requiresReview = dealTypes.includes('Review');
  const requiresRating = dealTypes.includes('Rating');

  const hasReviewProof = !!(o.reviewLink || o.screenshots?.review);
  const hasRatingProof = !!o.screenshots?.rating;

  const orderVerifiedAt = o.verification?.order?.verifiedAt ? new Date(o.verification.order.verifiedAt) : null;
  const reviewVerifiedAt = o.verification?.review?.verifiedAt ? new Date(o.verification.review.verifiedAt) : null;
  const ratingVerifiedAt = o.verification?.rating?.verifiedAt ? new Date(o.verification.rating.verifiedAt) : null;

  const requiredSteps: Array<'review' | 'rating'> = [
    ...(requiresReview ? (['review'] as const) : []),
    ...(requiresRating ? (['rating'] as const) : []),
  ];

  const missingProofs: Array<'review' | 'rating'> = [
    ...(requiresReview && !hasReviewProof ? (['review'] as const) : []),
    ...(requiresRating && !hasRatingProof ? (['rating'] as const) : []),
  ];

  const missingVerifications: Array<'review' | 'rating'> = [
    ...(requiresReview && !reviewVerifiedAt ? (['review'] as const) : []),
    ...(requiresRating && !ratingVerifiedAt ? (['rating'] as const) : []),
  ];

  return {
    id: String(o._id ?? o.id),
    items: (o.items ?? []).map((it: any) => ({
      productId: it.productId,
      title: it.title,
      image: it.image,
      priceAtPurchase: paiseToRupees(it.priceAtPurchasePaise),
      commission: paiseToRupees(it.commissionPaise),
      campaignId: String(it.campaignId),
      dealType: it.dealType,
      quantity: it.quantity,
      platform: it.platform,
      brandName: it.brandName,
    })),
    total: paiseToRupees(o.totalPaise),
    status: o.status,
    workflowStatus: o.workflowStatus,
    frozen: !!o.frozen,
    frozenAt: o.frozenAt ? new Date(o.frozenAt).toISOString() : undefined,
    frozenReason: o.frozenReason,
    paymentStatus: o.paymentStatus,
    affiliateStatus: o.affiliateStatus,
    externalOrderId: o.externalOrderId,
    settlementRef: (o as any).settlementRef,
    screenshots: o.screenshots ?? {},
    reviewLink: o.reviewLink,
    verification: {
      orderVerified: !!orderVerifiedAt,
      orderVerifiedAt: orderVerifiedAt ? orderVerifiedAt.toISOString() : undefined,
      reviewVerified: !!reviewVerifiedAt,
      reviewVerifiedAt: reviewVerifiedAt ? reviewVerifiedAt.toISOString() : undefined,
      ratingVerified: !!ratingVerifiedAt,
      ratingVerifiedAt: ratingVerifiedAt ? ratingVerifiedAt.toISOString() : undefined,
    },
    requirements: {
      required: requiredSteps,
      missingProofs,
      missingVerifications,
    },
    managerName: o.managerName,
    agencyName: o.agencyName,
    brandName: o.brandName,
    createdAt: new Date(o.createdAt ?? o.createdAtIso ?? Date.now()).toISOString(),
    expectedSettlementDate: o.expectedSettlementDate
      ? new Date(o.expectedSettlementDate).toISOString()
      : undefined,
  };
}

export function toUiTicketForBrand(t: TicketDoc & { _id?: any } | any) {
  return {
    id: String(t._id ?? t.id),
    // Do not leak who the buyer is to brands.
    userName: 'User',
    role: t.role,
    orderId: t.orderId,
    issueType: t.issueType,
    description: t.description,
    status: t.status,
    createdAt: new Date(t.createdAt ?? Date.now()).toISOString(),
  };
}
export function toUiTicket(t: TicketDoc & { _id?: any } | any) {
  return {
    id: String(t._id ?? t.id),
    userId: String(t.userId),
    userName: t.userName,
    role: t.role,
    orderId: t.orderId,
    issueType: t.issueType,
    description: t.description,
    status: t.status,
    createdAt: new Date(t.createdAt ?? Date.now()).toISOString(),
  };
}
