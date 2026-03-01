import { z } from 'zod';

// Accept both legacy 24-char hex IDs and PostgreSQL UUIDs
const entityId = z.string().regex(
  /^([0-9a-fA-F]{24}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  'Invalid ID format (expected hex ID or UUID)',
);

export const requestBrandConnectionSchema = z.object({
  brandCode: z.string().min(2).max(64),
});

export const resolveBrandConnectionSchema = z.object({
  // UI historically sends agencyId; some internal tools send agencyCode.
  agencyId: entityId.optional(),
  agencyCode: z.string().min(2).max(128).optional(),
  action: z.enum(['approve', 'reject']).default('approve'),
}).refine((v) => Boolean(v.agencyId || v.agencyCode), {
  message: 'Either agencyId or agencyCode is required',
});

export const removeBrandConnectionSchema = z.object({
  agencyCode: z.string().min(2).max(128),
});
