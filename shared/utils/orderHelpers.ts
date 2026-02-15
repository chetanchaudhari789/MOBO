import type { Order } from '../types';

/**
 * Return the best human-readable order identifier.
 * Prefers `externalOrderId` (from e-commerce platform),
 * falls back to internal `id`, or `'Pending'` if neither exists.
 */
export function getPrimaryOrderId(order: Order): string {
  return String(order.externalOrderId || order.id || '').trim() || 'Pending';
}

/**
 * Normalize nullable strings by filtering out 'null' and 'undefined' strings.
 * Returns empty string if the value is null, undefined, or the string 'null'/'undefined'.
 * Trims whitespace from valid strings.
 */
export function normalizeNullableString(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (trimmed === 'null' || trimmed === 'undefined') return '';
  return trimmed;
}

/**
 * Parse and validate an order date.
 * Returns null if the date is invalid or before 2021.
 * This filters out placeholder dates and ensures realistic order dates.
 */
export function parseValidOrderDate(dateValue: string | Date | null | undefined): Date | null {
  if (!dateValue) return null;
  const parsed = new Date(dateValue);
  if (isNaN(parsed.getTime())) return null;
  if (parsed.getFullYear() <= 2020) return null;
  return parsed;
}
