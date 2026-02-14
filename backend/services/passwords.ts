import bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const DEFAULT_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;

/**
 * Pre-hash long passwords with SHA-256 to avoid bcrypt's silent 72-byte truncation.
 * This ensures distinct passwords longer than 72 bytes still produce distinct hashes.
 */
function normalizePassword(plaintext: string): string {
  if (Buffer.byteLength(plaintext, 'utf-8') > BCRYPT_MAX_BYTES) {
    return crypto.createHash('sha256').update(plaintext).digest('base64');
  }
  return plaintext;
}

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(normalizePassword(plaintext), DEFAULT_ROUNDS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizePassword(plaintext), hash);
}
