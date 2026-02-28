import { z } from 'zod';

export const payoutAgencySchema = z.object({
  // UI sends these fields; backend uses auth user by default.
  brandId: z.string().min(1).optional(),
  agencyId: z.string().min(1),
  amount: z.coerce.number().positive(), // INR
  ref: z.string().trim().min(1).max(128),
});

export const createBrandCampaignSchema = z.object({
  brandId: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  brand: z.string().max(200).optional(),
  platform: z.string().min(1).max(80),
  dealType: z.enum(['Discount', 'Review', 'Rating']).optional(),
  price: z.number().nonnegative(),
  originalPrice: z.number().nonnegative(),
  payout: z.number().nonnegative(),
  image: z.string().min(1),
  productUrl: z.string().min(1),
  totalSlots: z.number().int().min(0),
  allowedAgencies: z.array(z.string().min(1)).min(1, 'allowedAgencies is required'),
  returnWindowDays: z.number().int().min(0).max(365).optional(),
});

export const updateBrandCampaignSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  platform: z.string().min(1).max(80).optional(),
  dealType: z.enum(['Discount', 'Review', 'Rating']).optional(),
  price: z.number().nonnegative().optional(),
  originalPrice: z.number().nonnegative().optional(),
  payout: z.number().nonnegative().optional(),
  image: z.string().min(1).optional(),
  productUrl: z.string().min(1).optional(),
  totalSlots: z.number().int().min(0).optional(),
  status: z.string().min(1).max(30).optional(),
  allowedAgencies: z.array(z.string().min(1)).optional(),
});

// ─── Query param validation ─────────────────────────────────────
export const brandCampaignsQuerySchema = z.object({
  brandId: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();

export const brandOrdersQuerySchema = z.object({
  brandName: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();

export const brandTransactionsQuerySchema = z.object({
  brandId: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();
