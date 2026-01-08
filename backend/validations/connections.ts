import { z } from 'zod';

export const requestBrandConnectionSchema = z.object({
  brandCode: z.string().min(2).max(64),
});

export const resolveBrandConnectionSchema = z.object({
  agencyCode: z.string().min(2).max(128),
});

export const removeBrandConnectionSchema = z.object({
  agencyCode: z.string().min(2).max(128),
});
