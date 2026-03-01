import crypto from 'crypto';

/**
 * Generates a human-readable code with high entropy.
 * Uses 8 random bytes (16 hex chars) for ~18.4 quintillion combinations.
 * Callers MUST check for uniqueness against the database.
 */
export function generateHumanCode(prefix: string) {
  const entropy = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${prefix}_${entropy}`;
}
