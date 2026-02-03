export function formatErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === 'string' && err.trim()) return err;

  if (err instanceof Error && err.message) {
    const requestId = (err as any).requestId;
    if (requestId) return `${err.message} (Request ID: ${String(requestId)})`;
    return err.message;
  }

  const requestId = (err as any)?.requestId;
  if (requestId) return `${fallback} (Request ID: ${String(requestId)})`;
  return fallback;
}
