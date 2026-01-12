import { z } from 'zod';

export const createInviteSchema = z.object({
  role: z.enum(['agency', 'mediator', 'brand', 'ops', 'admin', 'shopper']),
  label: z.string().min(1).max(120).optional(),
  parentUserId: z.string().min(1).optional(),
  parentCode: z.string().min(1).max(64).optional(),
  maxUses: z.coerce.number().int().min(1).max(10).optional(),
  ttlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .max(60 * 60 * 24 * 30)
    .optional(),
});

export const revokeInviteSchema = z.object({
  code: z.string().min(1).max(128),
  reason: z.string().min(1).max(500).optional(),
});

export const opsGenerateInviteSchema = z.object({
  agencyId: z.string().min(1),
});
