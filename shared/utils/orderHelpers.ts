import type { Order } from '../types';

/**
 * Return the best human-readable order identifier.
 * Prefers `externalOrderId` (from e-commerce platform),
 * falls back to internal `id`, or `'Pending'` if neither exists.
 */
export function getPrimaryOrderId(order: Order): string {
  return String(order.externalOrderId || order.id || '').trim() || 'Pending';
}
