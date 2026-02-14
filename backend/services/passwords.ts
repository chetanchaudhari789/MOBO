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
  const normalized = normalizePassword(plaintext);

  // Backward compatibility for legacy hashes created from raw passwords >72 bytes.
  // If normalization changed the password (i.e., it was SHA-256 pre-hashed),
  // first try comparing the raw plaintext (subject to bcrypt's truncation).
  if (normalized !== plaintext) {
    const legacyMatch = await bcrypt.compare(plaintext, hash);
    if (legacyMatch) {
      return true;
    }
  }

  // Fallback to comparing against the normalized password, which works for:
  // - New hashes that use SHA-256 pre-hashing for long passwords.
  // - All hashes for passwords <= 72 bytes (normalization is a no-op).
  return bcrypt.compare(normalized, hash);
}
