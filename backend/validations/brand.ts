import { z } from 'zod';

export const payoutAgencySchema = z.object({
  // UI sends these fields; backend uses auth user by default.
  brandId: z.string().min(1).optional(),
  agencyId: z.string().min(1),
  amount: z.coerce.number().positive(), // INR
  ref: z.string().trim().min(1).max(128),
});
