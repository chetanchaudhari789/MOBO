import { z } from 'zod';

export const updateUserStatusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(['active', 'suspended', 'pending']),
  reason: z.string().min(1).max(500).optional(),
});

export const reactivateOrderSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().min(1).max(500).optional(),
});

const normalizeRole = (value: unknown) => {
  const s = String(value ?? '').trim().toLowerCase();
  return s || undefined;
};
const normalizeOptionalString = (value: unknown) => {
  const s = String(value ?? '').trim();
  return s || undefined;
};

export const adminUsersQuerySchema = z.object({
  role: z.preprocess(
    normalizeRole,
    z.enum(['all', 'user', 'mediator', 'agency', 'brand', 'admin']).default('all')
  ),
  search: z.preprocess(normalizeOptionalString, z.string().max(120).optional()),
  status: z.preprocess(
    normalizeOptionalString,
    z.enum(['all', 'active', 'suspended', 'pending']).default('all')
  ),
});

export const adminFinancialsQuerySchema = z.object({
  status: z.preprocess(
    normalizeOptionalString,
    z.enum(['all', 'Pending_Cooling', 'Verified', 'Settled', 'Fraud_Alert', 'Unchecked', 'Frozen']).default('all')
  ),
  search: z.preprocess(normalizeOptionalString, z.string().max(120).optional()),
});

export const adminProductsQuerySchema = z.object({
  search: z.preprocess(normalizeOptionalString, z.string().max(120).optional()),
  active: z.preprocess(
    normalizeOptionalString,
    z.enum(['all', 'true', 'false']).default('all')
  ),
});
