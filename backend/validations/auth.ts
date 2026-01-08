import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: z.string().min(3).max(32),
  email: z.string().email().optional(),
  password: z.string().min(8).max(200),
  mediatorCode: z.string().min(1).max(64),
});

export const loginSchema = z.object({
  mobile: z.string().min(3).max(32),
  password: z.string().min(1).max(200),
});

export const registerOpsSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: z.string().min(3).max(32),
  password: z.string().min(8).max(200),
  role: z.enum(['agency', 'mediator']),
  code: z.string().min(1).max(128),
});

export const registerBrandSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: z.string().min(3).max(32),
  password: z.string().min(8).max(200),
  brandCode: z.string().min(2).max(64),
});

export const updateProfileSchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  avatar: z.string().min(1).max(10_000).optional(),
  upiId: z.string().min(1).max(128).optional(),
  qrCode: z.string().min(1).max(10_000).optional(),
  bankDetails: z
    .object({
      accountNumber: z.string().min(1).max(64).optional(),
      ifsc: z.string().min(1).max(32).optional(),
      bankName: z.string().min(1).max(120).optional(),
      holderName: z.string().min(1).max(120).optional(),
    })
    .optional(),
});
