import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const payoutAgencySchema = z.object({
  // UI sends these fields; backend uses auth user by default.
  brandId: objectId.optional(),
  agencyId: objectId,
  amount: z.coerce.number().positive(), // INR
  ref: z.string().trim().min(1).max(128),
});
