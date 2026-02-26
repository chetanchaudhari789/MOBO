/**
 * Reusable pagination helpers for list endpoints.
 * Provides a standard { data, total, page, limit } envelope.
 * Backward-compatible: returns plain array if client doesn't send ?page= or ?limit=
 */

/** Parse page/limit from query params with safe bounds */
export function parsePagination(query: Record<string, unknown>, defaults?: { page?: number; limit?: number }) {
  const page = Math.max(1, Number(query.page) || defaults?.page || 1);
  const limit = Math.min(500, Math.max(1, Number(query.limit) || defaults?.limit || 50));
  const skip = (page - 1) * limit;
  const isPaginated = query.page !== undefined || query.limit !== undefined;
  return { page, limit, skip, isPaginated };
}

/** Standard paginated response envelope */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Build response — returns paginated envelope if client sent ?page= or ?limit=,
 * otherwise returns plain array for backward compatibility.
 */
export function paginatedResponse<T>(data: T[], total: number, page: number, limit: number, isPaginated: boolean): PaginatedResponse<T> | T[] {
  if (!isPaginated) return data;
  return { data, total, page, limit };
}
