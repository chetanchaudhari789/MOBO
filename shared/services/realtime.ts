import { fixMojibakeDeep } from '../utils/mojibake';

type Listener = (msg: RealtimeMessage) => void;

export type RealtimeMessage = {
  type: string;
  ts: string;
  payload?: any;
};

const TOKEN_STORAGE_KEY = 'mobo_tokens_v1';

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
  // This avoids CORS/preflight problems when env vars point at a different origin.
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
  // using a direct absolute URL avoids proxy buffering of SSE.
  if (base === '/api' && typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalhost) base = 'http://localhost:8080/api';
  }

  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function normalizeApiRoot(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = String(raw).trim();
  if (!v) return undefined;

  // Allow passing either the service root (e.g. https://x.onrender.com)
  // or the API root (e.g. https://x.onrender.com/api).
  const withProto = v.startsWith('http://') || v.startsWith('https://') ? v : `https://${v}`;
  const noTrailing = withProto.endsWith('/') ? withProto.slice(0, -1) : withProto;
  return noTrailing.endsWith('/api') ? noTrailing : `${noTrailing}/api`;
}

// Realtime is a long-lived stream. In production we prefer connecting directly to the backend
// (when we have an absolute URL) because some hosting proxies/CDNs buffer or disrupt SSE.
function getRealtimeApiBaseUrl(): string {
  const baseFromEnv = normalizeApiRoot(
    (typeof process !== 'undefined' && (process as any).env && (process as any).env.NEXT_PUBLIC_API_PROXY_TARGET
      ? String((process as any).env.NEXT_PUBLIC_API_PROXY_TARGET)
      : undefined) ||
      (typeof process !== 'undefined' && (process as any).env && (process as any).env.NEXT_PUBLIC_API_URL
        ? String((process as any).env.NEXT_PUBLIC_API_URL)
        : undefined) ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_URL
        ? String((import.meta as any).env.VITE_API_URL)
        : undefined) ||
      ((globalThis as any).__MOBO_API_URL__ as string | undefined)
  );

  // Keep local dev behavior: talk directly to localhost backend when possible.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalhost) return 'http://localhost:8080/api';
  }

  return baseFromEnv || getApiBaseUrl();
}

function readAccessToken(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.accessToken;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

class RealtimeClient {
  private listeners = new Set<Listener>();
  private controller: AbortController | null = null;
  private running = false;
  private backoffMs = 1000;
  private storageListener: ((e: StorageEvent) => void) | null = null;

  // If the connection is open but we stop receiving bytes (proxy buffering/hanging),
  // force a reconnect so UI can recover.
  private readonly idleReconnectMs = 70_000;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    this.ensureRunning();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  stop() {
    this.running = false;
    this.backoffMs = 1000;
    if (this.controller) this.controller.abort();
    this.controller = null;
    if (this.storageListener && typeof window !== 'undefined') {
      try {
        window.removeEventListener('storage', this.storageListener);
      } catch {
        // ignore
      }
    }
    this.storageListener = null;
  }

  private ensureRunning() {
    if (this.running) return;
    this.running = true;

    // Cross-tab auth changes should trigger an immediate reconnect.
    if (!this.storageListener && typeof window !== 'undefined') {
      this.storageListener = (e: StorageEvent) => {
        if (e.key !== TOKEN_STORAGE_KEY) return;
        this.backoffMs = 1000;
        try {
          this.controller?.abort();
        } catch {
          // ignore
        }
      };
      try {
        window.addEventListener('storage', this.storageListener);
      } catch {
        // ignore
      }
    }

    void this.loop();
  }

  private async loop() {
    while (this.running && this.listeners.size > 0) {
      const token = readAccessToken();
      if (!token) {
        // No auth token; pause until someone logs in.
        await this.sleep(1500);
        continue;
      }

      const url = `${getRealtimeApiBaseUrl()}/realtime/stream`;
      const ctrl = new AbortController();
      this.controller = ctrl;

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          cache: 'no-store',
          signal: ctrl.signal,
        });

        if (!res.ok) {
          // Auth errors should not spin hot.
          if (res.status === 401 || res.status === 403) {
            this.dispatch({ type: 'auth.error', ts: new Date().toISOString(), payload: { status: res.status } });
            await this.sleep(3000);
          } else {
            await this.sleep(this.backoffMs);
          }
          // Add a little jitter to avoid reconnect stampedes.
          this.backoffMs = Math.min(Math.floor(this.backoffMs * 1.8 + Math.random() * 250), 12_000);
          continue;
        }

        this.backoffMs = 1000;

        const reader = res.body?.getReader();
        if (!reader) {
          await this.sleep(this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
          continue;
        }

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let eventName = 'message';
        let dataLines: string[] = [];

        let lastByteAt = Date.now();
        const idleTimer = setInterval(() => {
          if (!this.running) return;
          if (Date.now() - lastByteAt > this.idleReconnectMs) {
            try {
              ctrl.abort();
            } catch {
              // ignore
            }
          }
        }, 5_000);

        const flushEvent = () => {
          if (!dataLines.length) {
            eventName = 'message';
            return;
          }

          const rawData = dataLines.join('\n');
          dataLines = [];

          let payload: any = rawData;
          try {
            payload = JSON.parse(rawData);
          } catch {
            // keep as string
          }

          const ts =
            payload && typeof payload === 'object' && typeof payload.ts === 'string'
              ? payload.ts
              : new Date().toISOString();

          const innerPayload =
            payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'payload')
              ? (payload as any).payload
              : payload;

          this.dispatch({ type: eventName, ts, payload: fixMojibakeDeep(innerPayload) });
          eventName = 'message';
        };

        try {
          while (this.running && this.listeners.size > 0) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength) lastByteAt = Date.now();
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines.
            let idx: number;
            while ((idx = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, idx).replace(/\r$/, '');
              buffer = buffer.slice(idx + 1);

              if (!line) {
                flushEvent();
                continue;
              }

              if (line.startsWith(':')) continue; // comment

              if (line.startsWith('event:')) {
                eventName = line.slice('event:'.length).trim() || 'message';
                continue;
              }

              if (line.startsWith('data:')) {
                dataLines.push(line.slice('data:'.length).trimStart());
                continue;
              }
            }
          }
        } finally {
          clearInterval(idleTimer);
        }
      } catch (e) {
        if ((e as any)?.name !== 'AbortError') {
          await this.sleep(this.backoffMs);
          this.backoffMs = Math.min(Math.floor(this.backoffMs * 1.8 + Math.random() * 250), 12_000);
        }
      }
    }
  }

  private dispatch(msg: RealtimeMessage) {
    for (const l of Array.from(this.listeners)) {
      try {
        l(msg);
      } catch {
        // ignore listener errors
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const client = new RealtimeClient();

export function subscribeRealtime(listener: Listener) {
  return client.subscribe(listener);
}

export function stopRealtime() {
  client.stop();
}
