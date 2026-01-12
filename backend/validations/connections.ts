import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const requestBrandConnectionSchema = z.object({
  brandCode: z.string().min(2).max(64),
});

export const resolveBrandConnectionSchema = z.object({
  // UI historically sends agencyId; some internal tools send agencyCode.
  agencyId: objectId.optional(),
  agencyCode: z.string().min(2).max(128).optional(),
  action: z.enum(['approve', 'reject']).default('approve'),
}).refine((v) => Boolean(v.agencyId || v.agencyCode), {
  message: 'Either agencyId or agencyCode is required',
});

export const removeBrandConnectionSchema = z.object({
  agencyCode: z.string().min(2).max(128),
});
