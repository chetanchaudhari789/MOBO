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
export const settleOrderSchema = z.object({
  orderId: z.string().min(1),
  settlementRef: z.string().trim().min(2).max(128).optional(),
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
});

export const publishDealSchema = z.object({
  id: z.string().min(1), // campaign id
  commission: z.number().nonnegative(),
  mediatorCode: z.string().min(1),
});

export const payoutMediatorSchema = z.object({
  mediatorId: z.string().min(1),
  amount: z.number().positive(),
});
