import { User, Product, Order, Ticket } from '../types';
import { fixMojibakeDeep, maybeFixMojibake } from '../utils/mojibake';

function getApiBaseUrl(): string {
  const fromGlobal = (globalThis as any).__MOBO_API_URL__ as string | undefined;
  const fromVite =
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_API_URL
      ? String((import.meta as any).env.VITE_API_URL)
      : undefined;
  const fromNext =
    typeof process !== 'undefined' &&
    (process as any).env &&
    (process as any).env.NEXT_PUBLIC_API_URL
      ? String((process as any).env.NEXT_PUBLIC_API_URL)
      : undefined;

  const fromNextProxyTarget =
    typeof process !== 'undefined' &&
    (process as any).env &&
    (process as any).env.NEXT_PUBLIC_API_PROXY_TARGET
      ? String((process as any).env.NEXT_PUBLIC_API_PROXY_TARGET)
      : undefined;

  // In Next.js deployments we rely on same-origin `/api/*` + Next rewrites.
  // This avoids CORS problems when NEXT_PUBLIC_API_URL points at a different origin.
  const preferSameOriginProxy =
    typeof window !== 'undefined' &&
    typeof process !== 'undefined' &&
    (process as any).env &&
    (String((process as any).env.NEXT_PUBLIC_API_PROXY_TARGET || '').trim() ||
      String((process as any).env.NEXT_PUBLIC_API_URL || '').trim());

  const fromProxy = preferSameOriginProxy
    ? '/api'
    : fromNextProxyTarget
      ? (() => {
          const raw = String(fromNextProxyTarget).trim();
          if (!raw) return undefined;
          const trimmed = raw.endsWith('/') ? raw.slice(0, -1) : raw;
          return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
        })()
      : undefined;

  let base = (fromGlobal || fromVite || fromNext || fromProxy || '/api').trim();

  // Local dev fallback: if apps run on Next (300x) and backend on 8080,
  // talk to the backend directly unless overridden.
  if (base === '/api' && typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalhost) base = 'http://localhost:8080/api';
  }

  return base.endsWith('/') ? base.slice(0, -1) : base;
}

// Real API Base URL
const API_URL = getApiBaseUrl();

const TOKEN_STORAGE_KEY = 'mobo_tokens_v1';

type TokenPair = { accessToken: string; refreshToken?: string };

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage;

function readTokens(): TokenPair | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.accessToken !== 'string') return null;
    return parsed as TokenPair;
  } catch {
    return null;
  }
}

function writeTokens(tokens: TokenPair) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // ignore storage failures
  }
}

function authHeaders(): Record<string, string> {
  const tokens = readTokens();
  return tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {};
}

async function readPayloadSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function toErrorFromPayload(payload: any, fallback: string): Error {
  const message =
    payload?.error?.message ||
    payload?.message ||
    (typeof payload === 'string' ? payload : null) ||
    fallback;
  const err = new Error(maybeFixMojibake(String(message)));
  const code = payload?.error?.code || payload?.code;
  if (code) (err as any).code = code;
  return err;
}

function isPwaGuardEnabled(): boolean {
  return typeof window !== 'undefined' && (globalThis as any).__MOBO_ENABLE_PWA_GUARDS__ === true;
}

function assertOnlineForWrite(init?: RequestInit) {
  if (!isPwaGuardEnabled()) return;

  const method = String(init?.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  if (typeof navigator !== 'undefined' && navigator && 'onLine' in navigator && !navigator.onLine) {
    throw new Error('You appear to be offline. This action requires an internet connection.');
  }
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  assertOnlineForWrite(init);
  const res = await fetch(`${API_URL}${path}`, init);
  const payload = await readPayloadSafe(res);
  if (!res.ok) throw toErrorFromPayload(payload, `Request failed: ${res.status}`);
  return fixMojibakeDeep(payload);
}

async function fetchOk(path: string, init?: RequestInit): Promise<void> {
  assertOnlineForWrite(init);
  const res = await fetch(`${API_URL}${path}`, init);
  const payload = await readPayloadSafe(res);
  if (!res.ok) throw toErrorFromPayload(payload, `Request failed: ${res.status}`);
}

function unwrapAuthResponse(payload: any): any {
  // Supports either: { user, tokens } or direct user JSON.
  if (payload && typeof payload === 'object' && payload.user) {
    const tokens = payload.tokens;
    if (tokens?.accessToken) {
      writeTokens({
        accessToken: String(tokens.accessToken),
        refreshToken: tokens.refreshToken ? String(tokens.refreshToken) : undefined,
      });
    }
    const u = payload.user;
    if (u && typeof u === 'object' && typeof u.role === 'string') {
      // Backend uses `shopper`; UI expects legacy `user`.
      if (u.role === 'shopper') u.role = 'user';
    }
    // Normalize optional wallet fields expected by UI.
    if (u && typeof u === 'object') {
      if (typeof u.walletBalance === 'undefined') u.walletBalance = 0;
      if (typeof u.walletPending === 'undefined') u.walletPending = 0;
    }
    return u;
  }
  if (payload && typeof payload === 'object' && typeof payload.role === 'string') {
    if (payload.role === 'shopper') payload.role = 'user';
    if (typeof payload.walletBalance === 'undefined') payload.walletBalance = 0;
    if (typeof payload.walletPending === 'undefined') payload.walletPending = 0;
  }
  return payload;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * [FIX] Exported compressImage as it was missing and causing import errors in Chatbot.tsx.
 * Provides a simple placeholder for image compression logic.
 */
export const compressImage = async (base64: string): Promise<string> => {
  // In a real app, this would use canvas or a library to reduce dimensions/quality
  return base64;
};

/**
 * PRODUCTION API HANDLER
 * [FIX] Fully expanded the api object to include all methods used in the UI components
 * that were previously missing, causing "Property does not exist" errors.
 */
export const api = {
  auth: {
    me: async () => {
      const data = await fetchJson('/auth/me', {
        headers: { ...authHeaders() },
      });
      return unwrapAuthResponse(data);
    },
    login: async (mobile: string, pass: string) => {
      const data = await fetchJson('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, password: pass }),
      });
      return unwrapAuthResponse(data);
    },

    loginAdmin: async (username: string, pass: string) => {
      const data = await fetchJson('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pass }),
      });
      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing register method for AuthContext.tsx */
    register: async (name: string, mobile: string, pass: string, mediatorCode: string) => {
      const data = await fetchJson('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, mediatorCode }),
      });
      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing registerOps method for AuthContext.tsx */
    registerOps: async (name: string, mobile: string, pass: string, role: string, code: string) => {
      const data = await fetchJson('/auth/register-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, role, code }),
      });

      // Mediator join via agency code returns an accepted-but-pending response.
      if (data && typeof data === 'object' && data.pendingApproval) {
        return {
          pendingApproval: true,
          message: typeof data.message === 'string' ? data.message : 'Pending approval',
        };
      }

      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing registerBrand method for AuthContext.tsx */
    registerBrand: async (name: string, mobile: string, pass: string, brandCode: string) => {
      const data = await fetchJson('/auth/register-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, brandCode }),
      });
      return unwrapAuthResponse(data);
    },
    updateProfile: async (userId: string, updates: Partial<User>) => {
      const data = await fetchJson('/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, ...updates }),
      });
      return unwrapAuthResponse(data);
    },
  },
  products: {
    getAll: async (mediatorCode?: string) => {
      const query = mediatorCode ? `?mediatorCode=${encodeURIComponent(mediatorCode)}` : '';
      const data = await fetchJson(`/products${query}`, {
        headers: { ...authHeaders() },
      });
      return Array.isArray(data) ? data : [];
    },
  },
  orders: {
    /** [FIX] Added missing getUserOrders for Chatbot and Orders components */
    getUserOrders: async (userId: string) => {
      return fetchJson(`/orders/user/${encodeURIComponent(userId)}`, {
        headers: { ...authHeaders() },
      });
    },
    create: async (userId: string, items: any[], metadata: any) => {
      return fetchJson('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, items, ...metadata }),
      });
    },
    /** [FIX] Added missing submitClaim for Orders.tsx */
    submitClaim: async (orderId: string, proof: { type: string; data: string }) => {
      return fetchJson('/orders/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, ...proof }),
      });
    },
    /** [FIX] Added missing extractDetails for Orders.tsx */
    extractDetails: async (file: File) => {
      const imageBase64 = await readFileAsDataUrl(file);
      return fetchJson('/ai/extract-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ imageBase64 }),
      });
    },
  },
  chat: {
    /** [FIX] Updated signature to 7 arguments to match call in Chatbot.tsx */
    sendMessage: async (
      message: string,
      userId: string,
      userName: string,
      products: Product[],
      orders: Order[],
      tickets: Ticket[],
      image?: string
    ) => {
      return fetchJson('/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          message,
          userId,
          userName,
          products,
          orders,
          tickets,
          image,
        }),
      });
    },
  },
  ops: {
    /** [FIX] Expanded ops object with all methods used by MediatorDashboard and AgencyDashboard */
    getMediators: async (agencyCode: string) => {
      return fetchJson(`/ops/mediators?agencyCode=${encodeURIComponent(agencyCode)}`, {
        headers: { ...authHeaders() },
      });
    },
    getCampaigns: async (mediatorCode?: string) => {
      const query = mediatorCode ? `?mediatorCode=${encodeURIComponent(mediatorCode)}` : '';
      return fetchJson(`/ops/campaigns${query}`, {
        headers: { ...authHeaders() },
      });
    },
    getDeals: async (mediatorCode: string, role?: string) => {
      const query = role
        ? `?mediatorCode=${encodeURIComponent(mediatorCode)}&role=${encodeURIComponent(role)}`
        : `?mediatorCode=${encodeURIComponent(mediatorCode)}`;
      return fetchJson(`/ops/deals${query}`, {
        headers: { ...authHeaders() },
      });
    },
    getMediatorOrders: async (mediatorCode: string, role?: string) => {
      const query = role
        ? `?mediatorCode=${encodeURIComponent(mediatorCode)}&role=${encodeURIComponent(role)}`
        : `?mediatorCode=${encodeURIComponent(mediatorCode)}`;
      return fetchJson(`/ops/orders${query}`, {
        headers: { ...authHeaders() },
      });
    },
    getPendingUsers: async (code: string) => {
      return fetchJson(`/ops/users/pending?code=${encodeURIComponent(code)}`, {
        headers: { ...authHeaders() },
      });
    },
    getVerifiedUsers: async (code: string) => {
      return fetchJson(`/ops/users/verified?code=${encodeURIComponent(code)}`, {
        headers: { ...authHeaders() },
      });
    },
    getAgencyLedger: async () => {
      return fetchJson('/ops/ledger', {
        headers: { ...authHeaders() },
      });
    },
    approveMediator: async (id: string) => {
      await fetchOk('/ops/mediators/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    rejectMediator: async (id: string) => {
      await fetchOk('/ops/mediators/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    approveUser: async (id: string) => {
      await fetchOk('/ops/users/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    rejectUser: async (id: string) => {
      await fetchOk('/ops/users/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    settleOrderPayment: async (orderId: string, settlementRef?: string, settlementMode?: 'wallet' | 'external') => {
      await fetchOk('/ops/orders/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, settlementRef, settlementMode }),
      });
    },
    unsettleOrderPayment: async (orderId: string) => {
      await fetchOk('/ops/orders/unsettle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId }),
      });
    },
    verifyOrderClaim: async (orderId: string) => {
      return fetchJson('/ops/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId }),
      });
    },
    verifyOrderRequirement: async (orderId: string, type: 'review' | 'rating') => {
      return fetchJson('/ops/orders/verify-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, type }),
      });
    },
    createCampaign: async (data: any) => {
      return fetchJson('/ops/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
    assignSlots: async (
      id: string,
      assignments: any,
      dealType?: string,
      price?: number,
      payout?: number
    ) => {
      await fetchOk('/ops/campaigns/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, assignments, dealType, price, payout }),
      });
    },
    publishDeal: async (id: string, commission: number | undefined, mediatorCode: string) => {
      await fetchOk('/ops/deals/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, commission: Number.isFinite(commission as number) ? commission : 0, mediatorCode }),
      });
    },
    payoutMediator: async (mediatorId: string, amount: number) => {
      await fetchOk('/ops/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mediatorId, amount }),
      });
    },
    generateMediatorInvite: async (agencyId: string) => {
      const data = await fetchJson('/ops/invites/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ agencyId }),
      });
      return data?.code;
    },
    generateBuyerInvite: async (mediatorId: string) => {
      const data = await fetchJson('/ops/invites/generate-buyer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mediatorId }),
      });
      return data?.code;
    },
    connectBrand: async (brandCode: string) => {
      return fetchJson('/ops/brands/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandCode }),
      });
    },
    analyzeProof: async (
      orderId: string,
      proofUrl: string,
      expectedOrderId: string,
      expectedAmount: number
    ) => {
      return fetchJson('/ai/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          imageBase64: proofUrl,
          expectedOrderId,
          expectedAmount,
        }),
      });
    },
  },
  /** [FIX] Added missing brand object used in BrandDashboard.tsx */
  brand: {
    getConnectedAgencies: async (brandId: string) => {
      return fetchJson(`/brand/agencies?brandId=${encodeURIComponent(brandId)}`, {
        headers: { ...authHeaders() },
      });
    },
    getBrandCampaigns: async (brandId: string) => {
      return fetchJson(`/brand/campaigns?brandId=${encodeURIComponent(brandId)}`, {
        headers: { ...authHeaders() },
      });
    },
    getBrandOrders: async (brandName: string) => {
      return fetchJson(`/brand/orders?brandName=${encodeURIComponent(brandName)}`, {
        headers: { ...authHeaders() },
      });
    },
    getTransactions: async (brandId: string) => {
      return fetchJson(`/brand/transactions?brandId=${encodeURIComponent(brandId)}`, {
        headers: { ...authHeaders() },
      });
    },
    payoutAgency: async (brandId: string, agencyId: string, amount: number, ref: string) => {
      return fetchJson('/brand/payout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyId, amount, ref }),
      });
    },
    resolveConnectionRequest: async (brandId: string, agencyId: string, action: string) => {
      await fetchOk('/brand/requests/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyId, action }),
      });
    },
    removeAgency: async (brandId: string, agencyCode: string) => {
      await fetchOk('/brand/agencies/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyCode }),
      });
    },
    createCampaign: async (data: any) => {
      return fetchJson('/brand/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
    updateCampaign: async (campaignId: string, data: any) => {
      return fetchJson(`/brand/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
  },
  admin: {
    getStats: async () =>
      fetchJson('/admin/stats', {
        headers: { ...authHeaders() },
      }),
    /** [FIX] Updated getUsers to accept an optional role argument for AdminPortal.tsx */
    getUsers: async (role: string = 'all') =>
      fetchJson(`/admin/users?role=${encodeURIComponent(role)}`, {
        headers: { ...authHeaders() },
      }),
    /** [FIX] Added missing admin methods used in AdminPortal.tsx */
    getFinancials: async () =>
      fetchJson('/admin/financials', {
        headers: { ...authHeaders() },
      }),
    getProducts: async () =>
      fetchJson('/admin/products', {
        headers: { ...authHeaders() },
      }),
    getGrowthAnalytics: async () =>
      fetchJson('/admin/growth', {
        headers: { ...authHeaders() },
      }),
    getInvites: async () =>
      fetchJson('/admin/invites', {
        headers: { ...authHeaders() },
      }),
    getConfig: async () =>
      fetchJson('/admin/config', {
        headers: { ...authHeaders() },
      }),
    updateConfig: async (updates: { adminContactEmail?: string }) =>
      fetchJson('/admin/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(updates),
      }),
    generateInvite: async (role: string, label: string) => {
      return fetchJson('/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ role, label }),
      });
    },
    deleteInvite: async (code: string) => {
      await fetchOk(`/admin/invites/${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });
    },
    updateUserStatus: async (userId: string, status: string) => {
      await fetchOk('/admin/users/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, status }),
      });
    },
  },
  /** [FIX] Added missing tickets object used across various dashboards */
  tickets: {
    getAll: async () =>
      fetchJson('/tickets', {
        headers: { ...authHeaders() },
      }),
    create: async (data: any) => {
      await fetchOk('/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
    update: async (id: string, status: string) => {
      await fetchOk(`/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
    },
    delete: async (id: string) => {
      await fetchOk(`/tickets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      });
    },
  },
  /** AI-powered features for chat and proof verification */
  ai: {
    chat: async (payload: {
      message: string;
      userName?: string;
      products?: any[];
      orders?: any[];
      tickets?: any[];
      image?: string;
    }) => {
      return fetchJson('/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
    },
    verifyProof: async (payload: {
      imageBase64: string;
      expectedOrderId: string;
      expectedAmount: number;
    }) => {
      return fetchJson('/ai/verify-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
    },
  },

  notifications: {
    list: async () => {
      return fetchJson('/notifications', {
        method: 'GET',
        headers: { ...authHeaders() },
      });
    },
  },
};
