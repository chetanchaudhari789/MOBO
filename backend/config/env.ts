import { z } from 'zod';
import crypto from 'node:crypto';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  // Express body parser limits.
  // Use values supported by the `bytes` package syntax (e.g. '1mb', '500kb').
  REQUEST_BODY_LIMIT: z.string().trim().min(1).default('10mb'),

  // When true, seed + E2E flows may bypass external integrations.
  SEED_E2E: z.coerce.boolean().default(false),

  // When true, seed ONLY the admin account on startup (development/test only).
  SEED_ADMIN: z.coerce.boolean().default(false),
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
    // In dev/test, prefer stability over strength: if a value is provided and isn't a placeholder,
    // use it as-is (even if short) so JWT sessions remain valid across restarts.
    if (value && !looksPlaceholder(value)) return value;
    return crypto.randomBytes(32).toString('hex');
  };

  env.JWT_ACCESS_SECRET = ensureSecret('JWT_ACCESS_SECRET', processEnv.JWT_ACCESS_SECRET);
  env.JWT_REFRESH_SECRET = ensureSecret('JWT_REFRESH_SECRET', processEnv.JWT_REFRESH_SECRET);

  if (env.NODE_ENV === 'production' && looksPlaceholder(env.MONGODB_URI)) {
    throw new Error(
      'Invalid environment configuration:\nMONGODB_URI: must be set to a real MongoDB connection string in production'
    );
  }

  // Production safety: do not default to "allow all origins".
  // The API is consumed by multiple portals, so an explicit allowlist should always be configured.
  if (env.NODE_ENV === 'production') {
    const cors = parseCorsOrigins(env.CORS_ORIGINS);
    if (!cors.length) {
      throw new Error(
        'Invalid environment configuration:\nCORS_ORIGINS: must be set to a comma-separated list of allowed origins/hosts in production'
      );
    }
  }

  return env;
}

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
