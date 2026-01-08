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
