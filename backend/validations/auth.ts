import { z } from 'zod';
import { normalizeMobileTo10Digits } from '../utils/mobiles.js';

const mobile10Schema = z.preprocess(
  (value) => normalizeMobileTo10Digits(value),
  z.string().regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits')
);

function emptyStringToUndefined(value: unknown) {
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function optionalNonEmptyString(max: number) {
  return z.preprocess(emptyStringToUndefined, z.string().min(1).max(max).optional());
}

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: mobile10Schema,
  email: z.string().email().optional(),
  password: z.string().min(8).max(200),
  mediatorCode: z.string().min(1).max(64),
});

export const loginSchema = z.union([
  z.object({
    mobile: mobile10Schema,
    password: z.string().min(1).max(200),
  }),
  z.object({
    username: z.string().min(2).max(64),
    password: z.string().min(1).max(200),
  }),
]);

export const registerOpsSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: mobile10Schema,
  password: z.string().min(8).max(200),
  role: z.enum(['agency', 'mediator']),
  code: z.string().min(1).max(128),
});

export const registerBrandSchema = z.object({
  name: z.string().min(2).max(120),
  mobile: mobile10Schema,
  password: z.string().min(8).max(200),
  brandCode: z.string().min(2).max(64),
});

export const updateProfileSchema = z.object({
  userId: z.string().min(1).optional(),
  name: optionalNonEmptyString(120),
  email: z.preprocess(emptyStringToUndefined, z.string().email().optional()),
  // Data URLs / base64 images can be large; allow a reasonable limit.
  avatar: optionalNonEmptyString(2_000_000),
  upiId: optionalNonEmptyString(128),
  qrCode: optionalNonEmptyString(2_000_000),
  bankDetails: z
    .object({
      accountNumber: optionalNonEmptyString(64),
      ifsc: optionalNonEmptyString(32),
      bankName: optionalNonEmptyString(120),
      holderName: optionalNonEmptyString(120),
    })
    .optional(),
});
