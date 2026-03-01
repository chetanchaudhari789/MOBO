/**
 * Lightweight in-memory TTL cache for auth resolution results.
 *
 * Why: The auth middleware resolves user identity by running 1-4 sequential
 * DB queries per request (User lookup, suspension check, etc).  For the same
 * JWT within a short window those results are identical.  This cache
 * eliminates redundant DB round-trips and cuts auth latency to ~0 ms for
 * repeat requests.
 *
 * Design:
 * - Per-userId keying (not per-token) — so a user switching devices is still fast.
 * - 30s TTL by default (configurable via AUTH_CACHE_TTL_MS env var).
 * - FIFO eviction when MAX_ENTRIES is exceeded (prevents unbounded memory growth).
 * - Call `authCacheInvalidate(userId)` after role/suspension changes.
 */

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const TTL_MS = parseInt(process.env.AUTH_CACHE_TTL_MS || '30000', 10);
const MAX_ENTRIES = 5000;

const cache = new Map<string, CacheEntry>();

let hits = 0;
let misses = 0;

/**
 * Get a cached auth result for a user, or undefined if expired / missing.
 */
export function authCacheGet(userId: string): any | undefined {
  const entry = cache.get(userId);
  if (!entry) { misses++; return undefined; }
  if (Date.now() > entry.expiresAt) {
    cache.delete(userId);
    misses++;
    return undefined;
  }
  hits++;
  return entry.value;
}

/**
 * Store an auth result for a user.
 */
export function authCacheSet(userId: string, value: any): void {
  // FIFO eviction: if at capacity, delete the oldest entry.
  if (cache.size >= MAX_ENTRIES && !cache.has(userId)) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(userId, { value, expiresAt: Date.now() + TTL_MS });
}

/**
 * Remove a specific user's cached auth result (e.g. after suspension/role change).
 */
export function authCacheInvalidate(userId: string): void {
  cache.delete(userId);
}

/**
 * Clear the entire auth cache (e.g. during tests or emergency resets).
 */
export function authCacheClear(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/**
 * Return cache statistics for monitoring / diagnostics.
 */
export function authCacheStats() {
  return {
    size: cache.size,
    hits,
    misses,
    hitRate: hits + misses > 0 ? Math.round((hits / (hits + misses)) * 100) : 0,
  };
}
