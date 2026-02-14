/**
 * Sanitizes a value for CSV export to prevent formula injection attacks.
 * Prepends a single quote when the value starts with (optionally whitespace-prefixed):
 * =, +, -, @, tab, or carriage return.
 * Then escapes double quotes for CSV format.
 *
 * @param val - The value to sanitize
 * @returns A sanitized string safe for CSV export (without outer quotes)
 */
export function csvSafe(val: unknown): string {
  let s = String(val ?? '');
  // Check for dangerous characters that could trigger formula execution
  if (/^\s*[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return s.replace(/"/g, '""');
}

/**
 * Wraps a sanitized value in double quotes for CSV export.
 *
 * @param val - The value to sanitize and quote
 * @returns A quoted, sanitized string safe for CSV export
 */
export function csvSafeQuoted(val: unknown): string {
  return `"${csvSafe(val)}"`;
}
