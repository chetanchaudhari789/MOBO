import { z } from 'zod';

export const approveByIdSchema = z.object({
  id: z.string().min(1),
});

export const rejectByIdSchema = z.object({
  id: z.string().min(1),
});

export const verifyOrderSchema = z.object({
  orderId: z.string().min(1),
});

export const verifyOrderRequirementSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(['review', 'rating']),
});

export const rejectOrderProofSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(['order', 'review', 'rating']),
  reason: z.string().min(5).max(500),
});

export const requestMissingProofSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(['review', 'rating']),
  note: z.string().max(300).optional(),
});

const normalizeQueryString = (value: unknown) => String(value || '').trim();

export const opsOrdersQuerySchema = z.object({
  mediatorCode: z.preprocess(normalizeQueryString, z.string().min(1).optional()),
  role: z.preprocess(
    normalizeQueryString,
    z.enum(['agency', 'mediator']).optional()
  ),
});

export const opsMediatorQuerySchema = z.object({
  agencyCode: z.preprocess(normalizeQueryString, z.string().min(1).optional()),
  search: z.preprocess(normalizeQueryString, z.string().max(120).optional()),
});

export const opsCodeQuerySchema = z.object({
  code: z.preprocess(normalizeQueryString, z.string().min(1).optional()),
  search: z.preprocess(normalizeQueryString, z.string().max(120).optional()),
});

export const opsCampaignsQuerySchema = z.object({
  mediatorCode: z.preprocess(normalizeQueryString, z.string().min(1).optional()),
  status: z.preprocess(normalizeQueryString, z.enum(['all', 'active', 'paused', 'completed', 'draft']).default('all')),
});

export const opsDealsQuerySchema = z.object({
  mediatorCode: z.preprocess(normalizeQueryString, z.string().min(1).optional()),
  role: z.preprocess(normalizeQueryString, z.enum(['agency', 'mediator']).optional()),
});

export const deleteByIdParamSchema = z.object({
  id: z.string().min(1),
});
export const settleOrderSchema = z.object({
  orderId: z.string().min(1),
  settlementRef: z.string().trim().min(2).max(128).optional(),
  settlementMode: z.enum(['wallet', 'external']).optional(),
});

export const unsettleOrderSchema = z.object({
  orderId: z.string().min(1),
});

export const createCampaignSchema = z.object({
  // For privileged roles (admin/ops): required and must point at a brand user.
  // For non-privileged (agency/mediator): optional; backend will default to requester.
  brandUserId: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  platform: z.string().min(1).max(80),
  dealType: z.enum(['Discount', 'Review', 'Rating']).optional(),
  price: z.number().nonnegative(),
  originalPrice: z.number().nonnegative(),
  payout: z.number().nonnegative(),
  image: z.string().min(1),
  productUrl: z.string().min(1),
  totalSlots: z.number().int().min(0),
  allowedAgencies: z.array(z.string().min(1)).default([]),
  returnWindowDays: z.number().int().min(0).max(365).optional(),
});

export const assignSlotsSchema = z.object({
  id: z.string().min(1),
  assignments: z.record(
    z.string(),
    z.union([
      z.number().int().min(0),
      z.object({
        limit: z.number().int().min(0),
        payout: z.number().nonnegative().optional(),
      }),
    ])
  ),
  dealType: z.enum(['Discount', 'Review', 'Rating']).optional(),
  price: z.number().nonnegative().optional(),
  payout: z.number().nonnegative().optional(),
  commission: z.number().nonnegative().optional(),
});

export const updateCampaignStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'draft']),
});

export const publishDealSchema = z.object({
  id: z.string().min(1), // campaign id
  // Commission is optional; empty/omitted commission means 0.
  commission: z.number().nonnegative().default(0),
  mediatorCode: z.string().min(1),
});

export const payoutMediatorSchema = z.object({
  mediatorId: z.string().min(1),
  amount: z.number().positive(),
});
