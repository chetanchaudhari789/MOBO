import crypto from 'crypto';

export function generateHumanCode(prefix: string) {
  const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}_${entropy}`;
}
