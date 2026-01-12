<<<<<<< HEAD
import { User, Product, Order, Ticket } from '../types';
=======
import { User, Product, Order, Campaign, Ticket } from '../types';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

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

<<<<<<< HEAD
  const fromNextProxyTarget =
    typeof process !== 'undefined' &&
    (process as any).env &&
    (process as any).env.NEXT_PUBLIC_API_PROXY_TARGET
      ? String((process as any).env.NEXT_PUBLIC_API_PROXY_TARGET)
      : undefined;

  const fromProxy = fromNextProxyTarget
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

=======
  const base = (fromGlobal || fromVite || fromNext || '/api').trim();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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

<<<<<<< HEAD
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
  const err = new Error(String(message));
  const code = payload?.error?.code || payload?.code;
  if (code) (err as any).code = code;
  return err;
}

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, init);
  const payload = await readPayloadSafe(res);
  if (!res.ok) throw toErrorFromPayload(payload, `Request failed: ${res.status}`);
  return payload;
}

async function fetchOk(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, init);
  const payload = await readPayloadSafe(res);
  if (!res.ok) throw toErrorFromPayload(payload, `Request failed: ${res.status}`);
}

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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

<<<<<<< HEAD
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
      const data = await fetchJson('/auth/me', {
        headers: { ...authHeaders() },
      });
      return unwrapAuthResponse(data);
    },
    login: async (mobile: string, pass: string) => {
      const data = await fetchJson('/auth/login', {
=======
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return unwrapAuthResponse(data);
    },
    login: async (mobile: string, pass: string) => {
      const res = await fetch(`${API_URL}/auth/login`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, password: pass }),
      });
<<<<<<< HEAD
      return unwrapAuthResponse(data);
    },

    loginAdmin: async (username: string, pass: string) => {
      const data = await fetchJson('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pass }),
      });
=======
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing register method for AuthContext.tsx */
    register: async (name: string, mobile: string, pass: string, mediatorCode: string) => {
<<<<<<< HEAD
      const data = await fetchJson('/auth/register', {
=======
      const res = await fetch(`${API_URL}/auth/register`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, mediatorCode }),
      });
<<<<<<< HEAD
=======
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing registerOps method for AuthContext.tsx */
    registerOps: async (name: string, mobile: string, pass: string, role: string, code: string) => {
<<<<<<< HEAD
      const data = await fetchJson('/auth/register-ops', {
=======
      const res = await fetch(`${API_URL}/auth/register-ops`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, role, code }),
      });
<<<<<<< HEAD

      // Mediator join via agency code returns an accepted-but-pending response.
      if (data && typeof data === 'object' && data.pendingApproval) {
        return {
          pendingApproval: true,
          message: typeof data.message === 'string' ? data.message : 'Pending approval',
        };
      }

=======
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      return unwrapAuthResponse(data);
    },
    /** [FIX] Added missing registerBrand method for AuthContext.tsx */
    registerBrand: async (name: string, mobile: string, pass: string, brandCode: string) => {
<<<<<<< HEAD
      const data = await fetchJson('/auth/register-brand', {
=======
      const res = await fetch(`${API_URL}/auth/register-brand`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mobile, password: pass, brandCode }),
      });
<<<<<<< HEAD
      return unwrapAuthResponse(data);
    },
    updateProfile: async (userId: string, updates: Partial<User>) => {
      const data = await fetchJson('/auth/profile', {
=======
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return unwrapAuthResponse(data);
    },
    updateProfile: async (userId: string, updates: Partial<User>) => {
      const res = await fetch(`${API_URL}/auth/profile`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, ...updates }),
      });
<<<<<<< HEAD
=======
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      return unwrapAuthResponse(data);
    },
  },
  products: {
    getAll: async (mediatorCode?: string) => {
<<<<<<< HEAD
      const query = mediatorCode ? `?mediatorCode=${encodeURIComponent(mediatorCode)}` : '';
      const data = await fetchJson(`/products${query}`, {
        headers: { ...authHeaders() },
      });
      return Array.isArray(data) ? data : [];
=======
      try {
        const query = mediatorCode ? `?mediatorCode=${mediatorCode}` : '';
        const res = await fetch(`${API_URL}/products${query}`, {
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          console.error('Failed to fetch products:', res.status);
          return [];
        }
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error('Error fetching products:', error);
        return [];
      }
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
  },
  orders: {
    /** [FIX] Added missing getUserOrders for Chatbot and Orders components */
    getUserOrders: async (userId: string) => {
<<<<<<< HEAD
      return fetchJson(`/orders/user/${encodeURIComponent(userId)}`, {
        headers: { ...authHeaders() },
      });
    },
    create: async (userId: string, items: any[], metadata: any) => {
      return fetchJson('/orders', {
=======
      const res = await fetch(`${API_URL}/orders/user/${userId}`, {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    create: async (userId: string, items: any[], metadata: any) => {
      const res = await fetch(`${API_URL}/orders`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, items, ...metadata }),
      });
<<<<<<< HEAD
    },
    /** [FIX] Added missing submitClaim for Orders.tsx */
    submitClaim: async (orderId: string, proof: { type: string; data: string }) => {
      return fetchJson('/orders/claim', {
=======
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    /** [FIX] Added missing submitClaim for Orders.tsx */
    submitClaim: async (orderId: string, proof: { type: string; data: string }) => {
      const res = await fetch(`${API_URL}/orders/claim`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, ...proof }),
      });
<<<<<<< HEAD
    },
    /** [FIX] Added missing extractDetails for Orders.tsx */
    extractDetails: async (file: File) => {
      const imageBase64 = await readFileAsDataUrl(file);
      return fetchJson('/ai/extract-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ imageBase64 }),
      });
=======
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    /** [FIX] Added missing extractDetails for Orders.tsx */
    extractDetails: async (file: File) => {
      // Simulated AI extraction logic
      return { orderId: 'EXT-' + Math.random().toString(36).substr(2, 9), amount: 1500 };
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
      return fetchJson('/ai/chat', {
=======
      const res = await fetch(`${API_URL}/ai/chat`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
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
<<<<<<< HEAD
=======
      if (!res.ok) throw new Error(await res.text());
      return res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
  },
  ops: {
    /** [FIX] Expanded ops object with all methods used by MediatorDashboard and AgencyDashboard */
    getMediators: async (agencyCode: string) => {
<<<<<<< HEAD
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
=======
      const res = await fetch(`${API_URL}/ops/mediators?agencyCode=${agencyCode}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getCampaigns: async (mediatorCode?: string) => {
      const query = mediatorCode ? `?mediatorCode=${mediatorCode}` : '';
      const res = await fetch(`${API_URL}/ops/campaigns${query}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getMediatorOrders: async (mediatorCode: string, role?: string) => {
      const query = role
        ? `?mediatorCode=${mediatorCode}&role=${role}`
        : `?mediatorCode=${mediatorCode}`;
      const res = await fetch(`${API_URL}/ops/orders${query}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getPendingUsers: async (code: string) => {
      const res = await fetch(`${API_URL}/ops/users/pending?code=${code}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getVerifiedUsers: async (code: string) => {
      const res = await fetch(`${API_URL}/ops/users/verified?code=${code}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getAgencyLedger: async () => {
      const res = await fetch(`${API_URL}/ops/ledger`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    approveMediator: async (id: string) => {
      return fetch(`${API_URL}/ops/mediators/approve`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    approveUser: async (id: string) => {
<<<<<<< HEAD
      await fetchOk('/ops/users/approve', {
=======
      return fetch(`${API_URL}/ops/users/approve`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    rejectUser: async (id: string) => {
<<<<<<< HEAD
      await fetchOk('/ops/users/reject', {
=======
      return fetch(`${API_URL}/ops/users/reject`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id }),
      });
    },
    settleOrderPayment: async (orderId: string, settlementRef?: string) => {
<<<<<<< HEAD
      await fetchOk('/ops/orders/settle', {
=======
      return fetch(`${API_URL}/ops/orders/settle`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, settlementRef }),
      });
    },
<<<<<<< HEAD
    unsettleOrderPayment: async (orderId: string) => {
      await fetchOk('/ops/orders/unsettle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId }),
      });
    },
    verifyOrderClaim: async (orderId: string) => {
      return fetchJson('/ops/verify', {
=======
    verifyOrderClaim: async (orderId: string) => {
      return fetch(`${API_URL}/ops/verify`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId }),
      });
    },
<<<<<<< HEAD
    verifyOrderRequirement: async (orderId: string, type: 'review' | 'rating') => {
      return fetchJson('/ops/orders/verify-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ orderId, type }),
      });
    },
    createCampaign: async (data: any) => {
      return fetchJson('/ops/campaigns', {
=======
    createCampaign: async (data: any) => {
      const res = await fetch(`${API_URL}/ops/campaigns`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
<<<<<<< HEAD
=======
      return res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
    assignSlots: async (
      id: string,
      assignments: any,
      dealType?: string,
      price?: number,
      payout?: number
    ) => {
<<<<<<< HEAD
      await fetchOk('/ops/campaigns/assign', {
=======
      return fetch(`${API_URL}/ops/campaigns/assign`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, assignments, dealType, price, payout }),
      });
    },
    publishDeal: async (id: string, commission: number, mediatorCode: string) => {
<<<<<<< HEAD
      await fetchOk('/ops/deals/publish', {
=======
      return fetch(`${API_URL}/ops/deals/publish`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id, commission, mediatorCode }),
      });
    },
    payoutMediator: async (mediatorId: string, amount: number) => {
<<<<<<< HEAD
      await fetchOk('/ops/payouts', {
=======
      return fetch(`${API_URL}/ops/payouts`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mediatorId, amount }),
      });
    },
    generateMediatorInvite: async (agencyId: string) => {
<<<<<<< HEAD
      const data = await fetchJson('/ops/invites/generate', {
=======
      const res = await fetch(`${API_URL}/ops/invites/generate`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ agencyId }),
      });
<<<<<<< HEAD
      return data?.code;
    },
    generateBuyerInvite: async (mediatorId: string) => {
      const data = await fetchJson('/ops/invites/generate-buyer', {
=======
      const data = await res.json();
      return data.code;
    },
    generateBuyerInvite: async (mediatorId: string) => {
      const res = await fetch(`${API_URL}/ops/invites/generate-buyer`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mediatorId }),
      });
<<<<<<< HEAD
      return data?.code;
    },
    connectBrand: async (brandCode: string) => {
      return fetchJson('/ops/brands/connect', {
=======
      const data = await res.json();
      return data.code;
    },
    connectBrand: async (brandCode: string) => {
      const res = await fetch(`${API_URL}/ops/brands/connect`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandCode }),
      });
<<<<<<< HEAD
=======

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(payload?.error?.message || 'Failed to send connection request');
        (err as any).code = payload?.error?.code;
        throw err;
      }

      return payload;
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
    analyzeProof: async (
      orderId: string,
      proofUrl: string,
      expectedOrderId: string,
      expectedAmount: number
    ) => {
<<<<<<< HEAD
      return fetchJson('/ai/verify-proof', {
=======
      const res = await fetch(`${API_URL}/ai/verify-proof`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          imageBase64: proofUrl,
          expectedOrderId,
          expectedAmount,
        }),
      });
<<<<<<< HEAD
=======
      if (!res.ok) throw new Error(await res.text());
      return res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
  },
  /** [FIX] Added missing brand object used in BrandDashboard.tsx */
  brand: {
    getConnectedAgencies: async (brandId: string) => {
<<<<<<< HEAD
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
=======
      const res = await fetch(`${API_URL}/brand/agencies?brandId=${brandId}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getBrandCampaigns: async (brandId: string) => {
      const res = await fetch(`${API_URL}/brand/campaigns?brandId=${brandId}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getBrandOrders: async (brandName: string) => {
      const res = await fetch(`${API_URL}/brand/orders?brandName=${brandName}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    getTransactions: async (brandId: string) => {
      const res = await fetch(`${API_URL}/brand/transactions?brandId=${brandId}`, {
        headers: { ...authHeaders() },
      });
      return res.json();
    },
    payoutAgency: async (brandId: string, agencyId: string, amount: number, ref: string) => {
      const res = await fetch(`${API_URL}/brand/payout`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyId, amount, ref }),
      });
<<<<<<< HEAD
    },
    resolveConnectionRequest: async (brandId: string, agencyId: string, action: string) => {
      await fetchOk('/brand/requests/resolve', {
=======
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(payload?.error?.message || 'Failed to record payment');
        (err as any).code = payload?.error?.code;
        throw err;
      }
      return payload;
    },
    resolveConnectionRequest: async (brandId: string, agencyId: string, action: string) => {
      return fetch(`${API_URL}/brand/requests/resolve`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyId, action }),
      });
    },
    removeAgency: async (brandId: string, agencyCode: string) => {
<<<<<<< HEAD
      await fetchOk('/brand/agencies/remove', {
=======
      return fetch(`${API_URL}/brand/agencies/remove`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ brandId, agencyCode }),
      });
    },
    createCampaign: async (data: any) => {
<<<<<<< HEAD
      return fetchJson('/brand/campaigns', {
=======
      const res = await fetch(`${API_URL}/brand/campaigns`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
<<<<<<< HEAD
    },
    updateCampaign: async (campaignId: string, data: any) => {
      return fetchJson(`/brand/campaigns/${campaignId}`, {
=======
      return res.json();
    },
    updateCampaign: async (campaignId: string, data: any) => {
      return fetch(`${API_URL}/brand/campaigns/${campaignId}`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
  },
  admin: {
<<<<<<< HEAD
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
=======
    getStats: async () => (await fetch(`${API_URL}/admin/stats`, { headers: { ...authHeaders() } })).json(),
    /** [FIX] Updated getUsers to accept an optional role argument for AdminPortal.tsx */
    getUsers: async (role: string = 'all') =>
      (await fetch(`${API_URL}/admin/users?role=${role}`, { headers: { ...authHeaders() } })).json(),
    /** [FIX] Added missing admin methods used in AdminPortal.tsx */
    getFinancials: async () => (await fetch(`${API_URL}/admin/financials`, { headers: { ...authHeaders() } })).json(),
    getProducts: async () => (await fetch(`${API_URL}/admin/products`, { headers: { ...authHeaders() } })).json(),
    getGrowthAnalytics: async () => (await fetch(`${API_URL}/admin/growth`, { headers: { ...authHeaders() } })).json(),
    getInvites: async () => (await fetch(`${API_URL}/admin/invites`, { headers: { ...authHeaders() } })).json(),
    generateInvite: async (role: string, label: string) => {
      const res = await fetch(`${API_URL}/admin/invites`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ role, label }),
      });
<<<<<<< HEAD
    },
    updateUserStatus: async (userId: string, status: string) => {
      await fetchOk('/admin/users/status', {
=======
      return res.json();
    },
    updateUserStatus: async (userId: string, status: string) => {
      return fetch(`${API_URL}/admin/users/status`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, status }),
      });
    },
  },
  /** [FIX] Added missing tickets object used across various dashboards */
  tickets: {
<<<<<<< HEAD
    getAll: async () =>
      fetchJson('/tickets', {
        headers: { ...authHeaders() },
      }),
    create: async (data: any) => {
      await fetchOk('/tickets', {
=======
    getAll: async () => (await fetch(`${API_URL}/tickets`, { headers: { ...authHeaders() } })).json(),
    create: async (data: any) => {
      return fetch(`${API_URL}/tickets`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
    },
    update: async (id: string, status: string) => {
<<<<<<< HEAD
      await fetchOk(`/tickets/${id}`, {
=======
      return fetch(`${API_URL}/tickets/${id}`, {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
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
<<<<<<< HEAD
      return fetchJson('/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
=======
      const res = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: { message: 'AI service error' } }));
        throw new Error(error.error?.message || 'AI request failed');
      }
      return res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
    verifyProof: async (payload: {
      imageBase64: string;
      expectedOrderId: string;
      expectedAmount: number;
    }) => {
<<<<<<< HEAD
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
=======
      const res = await fetch(`${API_URL}/ai/verify-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: { message: 'AI verification error' } }));
        throw new Error(error.error?.message || 'Proof verification failed');
      }
      return res.json();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
    },
  },
};
