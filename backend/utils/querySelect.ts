/**
 * Reusable Prisma `select` configurations for list queries.
 *
 * List endpoints don't need events (unbounded JSONB array),
 * AI verification (3 JSONB blocks), or missing-proof requests.
 * Stripping them reduces row transfer size significantly.
 */

/**
 * Prisma `select` for Order list queries.
 * Includes everything EXCEPT heavy JSON columns.
 */
export const orderListSelect = {
  id: true,
  userId: true,
  brandUserId: true,
  totalPaise: true,
  workflowStatus: true,
  frozen: true,
  frozenAt: true,
  frozenReason: true,
  status: true,
  paymentStatus: true,
  affiliateStatus: true,
  externalOrderId: true,
  orderDate: true,
  soldBy: true,
  extractedProductName: true,
  settlementRef: true,
  settlementMode: true,
  // Keep screenshot URL columns for boolean proof flags
  screenshotOrder: true,
  screenshotPayment: true,
  screenshotReview: true,
  screenshotRating: true,
  screenshotReturnWindow: true,
  reviewLink: true,
  returnWindowDays: true,
  // Rejection flat fields
  rejectionType: true,
  rejectionReason: true,
  rejectionAt: true,
  rejectionBy: true,
  // Verification JSONB (small, needed for verified-status flags)
  verification: true,
  // Display names
  managerName: true,
  agencyName: true,
  buyerName: true,
  buyerMobile: true,
  reviewerName: true,
  brandName: true,
  // Timestamps
  expectedSettlementDate: true,
  createdAt: true,
  updatedAt: true,
  // Relations — items needed for deal type / platform info
  items: true,
  // EXCLUDED (heavy):
  // - events (JSONB array, can be huge)
  // - orderAiVerification (JSONB)
  // - ratingAiVerification (JSONB)
  // - returnWindowAiVerification (JSONB)
  // - missingProofRequests (JSONB array)
} as const;
