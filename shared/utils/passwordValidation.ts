/**
 * Shared password validation utilities
 */

export function validateStrongPassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password needs 8+ chars with uppercase, lowercase, number, and special character.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password needs 8+ chars with uppercase, lowercase, number, and special character.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password needs 8+ chars with uppercase, lowercase, number, and special character.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password needs 8+ chars with uppercase, lowercase, number, and special character.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password needs 8+ chars with uppercase, lowercase, number, and special character.';
  }
  return null; // Valid
}
