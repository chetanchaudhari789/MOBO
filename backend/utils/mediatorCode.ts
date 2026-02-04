export function normalizeMediatorCode(value: unknown): string {
  return String(value || '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildMediatorCodeRegex(value: unknown): RegExp | null {
  const normalized = normalizeMediatorCode(value);
  if (!normalized) return null;
  return new RegExp(`^${escapeRegExp(normalized)}$`, 'i');
}