/**
 * PG → Controller Mappers
 *
 * Transforms Prisma (PostgreSQL) results into the nested-document format
 * expected by uiMappers and controller logic.
 *
 * Key transformations:
 * 1. `_id = mongoId` — backward compat with Mongoose-format consumers.
 * 2. User: flat KYC / bank fields → nested kycDocuments / bankDetails objects.
 * 3. Order: flat screenshot / rejection fields → nested subdocuments.
 */

// ────────────── generic ──────────────

/** Add `_id = mongoId` for backward compat with code that expects Mongoose docs. */
export function withId<T extends { mongoId?: string | null; id: string }>(raw: T): T & { _id: string } {
  return { ...raw, _id: (raw.mongoId ?? raw.id) as string };
}

/** Map an array of PG results – null-safe. */
export function mapAll<T>(items: T[] | null | undefined, mapper: (item: T) => any): any[] {
  if (!items) return [];
  return items.map(mapper);
}

// ────────────── User ──────────────

/** Map PG User to controller-compatible format. */
export function pgUser(raw: any): any {
  if (!raw) return null;
  return {
    ...raw,
    _id: raw.mongoId ?? raw.id,
    kycDocuments: {
      panCard: raw.kycPanCard ?? null,
      aadhaar: raw.kycAadhaar ?? null,
      gst: raw.kycGst ?? null,
    },
    bankDetails: {
      accountNumber: raw.bankAccountNumber ?? null,
      ifsc: raw.bankIfsc ?? null,
      bankName: raw.bankName ?? null,
      holderName: raw.bankHolderName ?? null,
    },
    pendingConnections: Array.isArray(raw.pendingConnections)
      ? raw.pendingConnections.map((p: any) => ({
          agencyId: p.agencyUserId ?? p.agencyId,
          agencyName: p.agencyName,
          agencyCode: p.agencyCode,
          timestamp: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
        }))
      : [],
  };
}

// ────────────── Order ──────────────

/** Map PG Order to controller-compatible format. */
export function pgOrder(raw: any): any {
  if (!raw) return null;
  return {
    ...raw,
    _id: raw.mongoId ?? raw.id,
    userId: raw.userId,
    screenshots: {
      order: raw.screenshotOrder ?? null,
      payment: raw.screenshotPayment ?? null,
      review: raw.screenshotReview ?? null,
      rating: raw.screenshotRating ?? null,
      returnWindow: raw.screenshotReturnWindow ?? null,
    },
    rejection: raw.rejectionType
      ? {
          type: raw.rejectionType,
          reason: raw.rejectionReason ?? null,
          rejectedAt: raw.rejectionAt ?? null,
          rejectedBy: raw.rejectionBy ?? null,
        }
      : null,
    // verification: JSONB – comes as-is
    // events: JSONB – comes as-is
    // missingProofRequests: JSONB – comes as-is
  };
}

// ────────────── Campaign ──────────────

/** Map PG Campaign. Assignments is already JSONB. */
export function pgCampaign(raw: any): any {
  if (!raw) return null;
  return {
    ...raw,
    _id: raw.mongoId ?? raw.id,
    // assignments: JSONB – comes as-is
    // allowedAgencyCodes: string[] – same as Mongoose
  };
}

// ────────────── Deal ──────────────

export function pgDeal(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Ticket ──────────────

export function pgTicket(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Wallet ──────────────

export function pgWallet(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Transaction ──────────────

export function pgTransaction(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Invite ──────────────

export function pgInvite(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Payout ──────────────

export function pgPayout(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}

// ────────────── Suspension ──────────────

export function pgSuspension(raw: any): any {
  if (!raw) return null;
  return { ...raw, _id: raw.mongoId ?? raw.id };
}
