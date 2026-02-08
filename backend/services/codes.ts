import crypto from 'crypto';

export function generateHumanCode(prefix: string) {
  const entropy = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}_${entropy}`;
}
