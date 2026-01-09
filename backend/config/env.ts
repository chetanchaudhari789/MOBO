import { z } from 'zod';
import crypto from 'node:crypto';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  // When true, seed + E2E flows may bypass external integrations.
  SEED_E2E: z.coerce.boolean().default(false),

  MONGODB_URI: z.string().min(1),
  MONGODB_DBNAME: z.string().trim().min(1).optional(),

  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  CORS_ORIGINS: z.string().default(''),

  GEMINI_API_KEY: z.string().optional(),
});

type EnvSchema = z.infer<typeof envSchema>;

export type Env = Omit<EnvSchema, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'> & {
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
};

export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(processEnv);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const env = parsed.data as any as Env;

  const looksPlaceholder = (value: string | undefined) => {
    if (!value) return true;
    const v = value.trim();
    if (!v) return true;
    if (v.includes('REPLACE_ME')) return true;
    if (v.startsWith('<') && v.endsWith('>')) return true;
    return false;
  };

  const ensureSecret = (
    name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
    value: string | undefined
  ) => {
    if (env.NODE_ENV === 'production') {
      if (!value || value.length < 20 || looksPlaceholder(value)) {
        throw new Error(
          `Invalid environment configuration:\n${name}: must be set to a secure random string (>= 20 chars) in production`
        );
      }
      return value;
    }
    if (!value || value.length < 20 || looksPlaceholder(value)) {
      return crypto.randomBytes(32).toString('hex');
    }
    return value;
  };

  env.JWT_ACCESS_SECRET = ensureSecret('JWT_ACCESS_SECRET', processEnv.JWT_ACCESS_SECRET);
  env.JWT_REFRESH_SECRET = ensureSecret('JWT_REFRESH_SECRET', processEnv.JWT_REFRESH_SECRET);

  if (env.NODE_ENV === 'production' && looksPlaceholder(env.MONGODB_URI)) {
    throw new Error(
      'Invalid environment configuration:\nMONGODB_URI: must be set to a real MongoDB connection string in production'
    );
  }

  return env;
}

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
