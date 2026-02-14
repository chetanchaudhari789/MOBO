/**
 * Format a number as Indian Rupees (INR) currency.
 * Uses Intl.NumberFormat for locale-safe formatting.
 *
 * @param amount  Amount in base units (rupees, not paise)
 * @param opts    Optional overrides for fraction digits
 */
export function formatCurrency(
  amount: number,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
    maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
  }).format(amount);
}
