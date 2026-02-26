import { prisma } from '../database/prisma.js';

// ─── Simple TTL cache for hierarchical lookups ─────────────────────────
const LINEAGE_TTL_MS = 60_000; // 60 seconds
interface CacheEntry<T> { value: T; expiresAt: number; }

const mediatorCodesCache = new Map<string, CacheEntry<string[]>>();
const agencyCodeCache = new Map<string, CacheEntry<string | null>>();
const activeCache = new Map<string, CacheEntry<boolean>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (cache.size > 2000) cache.delete(cache.keys().next().value!); // FIFO eviction
  cache.set(key, { value, expiresAt: Date.now() + LINEAGE_TTL_MS });
}

/** Clear all lineage caches (call on user/role mutations) */
export function clearLineageCache(): void {
  mediatorCodesCache.clear();
  agencyCodeCache.clear();
  activeCache.clear();
}
// ───────────────────────────────────────────────────────────────────────

export async function listMediatorCodesForAgency(agencyCode: string): Promise<string[]> {
  if (!agencyCode) return [];
  const cached = getCached(mediatorCodesCache, agencyCode);
  if (cached !== undefined) return cached;
  const db = prisma();
  const mediators = await db.user.findMany({
    where: { roles: { has: 'mediator' as any }, parentCode: agencyCode, deletedAt: null },
    select: { mediatorCode: true },
  });
  const codes = mediators.map((m) => String(m.mediatorCode || '')).filter(Boolean);
  setCached(mediatorCodesCache, agencyCode, codes);
  return codes;
}

export async function getAgencyCodeForMediatorCode(mediatorCode: string): Promise<string | null> {
  if (!mediatorCode) return null;
  const cached = getCached(agencyCodeCache, mediatorCode);
  if (cached !== undefined) return cached;
  const db = prisma();
  const mediator = await db.user.findFirst({
    where: { roles: { has: 'mediator' as any }, mediatorCode, deletedAt: null },
    select: { parentCode: true },
  });
  const agencyCode = mediator ? String(mediator.parentCode || '').trim() : '';
  const result = agencyCode || null;
  setCached(agencyCodeCache, mediatorCode, result);
  return result;
}

export async function isAgencyActive(agencyCode: string): Promise<boolean> {
  if (!agencyCode) return false;
  const cached = getCached(activeCache, `agency:${agencyCode}`);
  if (cached !== undefined) return cached;
  const db = prisma();
  const agency = await db.user.findFirst({
    where: { roles: { has: 'agency' as any }, mediatorCode: agencyCode, deletedAt: null },
    select: { status: true },
  });
  const result = !!agency && agency.status === 'active';
  setCached(activeCache, `agency:${agencyCode}`, result);
  return result;
}

export async function isMediatorActive(mediatorCode: string): Promise<boolean> {
  if (!mediatorCode) return false;
  const cached = getCached(activeCache, `mediator:${mediatorCode}`);
  if (cached !== undefined) return cached;
  const db = prisma();
  const mediator = await db.user.findFirst({
    where: { roles: { has: 'mediator' as any }, mediatorCode, deletedAt: null },
    select: { status: true },
  });
  const result = !!mediator && mediator.status === 'active';
  setCached(activeCache, `mediator:${mediatorCode}`, result);
  return result;
}
