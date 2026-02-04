import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { Role } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { subscribeRealtime, type RealtimeEvent } from '../services/realtimeHub.js';

function writeSse(res: any, evt: { event: string; data?: any }): boolean {
  // Never throw from a realtime emitter callback.
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${evt.event}\n`);
    if (typeof evt.data !== 'undefined') {
      const payload = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data);
      // SSE allows multi-line data; keep it single-line JSON.
      res.write(`data: ${payload}\n`);
    }
    res.write('\n');
    // If the runtime supports it, flush bytes immediately.
    if (typeof (res as any).flush === 'function') (res as any).flush();
    return true;
  } catch {
    return false;
  }
}

function shouldDeliver(evt: RealtimeEvent, ctx: { userId: string; roles: Role[] }): boolean {
  const aud = evt.audience;
  // Fail closed: realtime events must declare an explicit audience.
  // Use { audience: { broadcast: true } } for broadcasts.
  if (!aud) return false;
  if (aud.broadcast) return true;
  if (Array.isArray(aud.userIds) && aud.userIds.includes(ctx.userId)) return true;
  if (Array.isArray(aud.roles) && aud.roles.some((r) => ctx.roles.includes(r))) return true;
  return false;
}

export function realtimeRoutes(env: Env) {
  const r = Router();

  // Lightweight health check for the realtime subsystem.
  // Does not require auth and does not open a long-lived SSE stream.
  r.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Streaming endpoint for realtime UI updates.
  // Auth is via standard Bearer token header (same as REST routes).
  r.get('/stream', requireAuth(env), (req, res) => {
    // Avoid proxy / load balancer / Node defaults closing the connection.
    try {
      req.socket.setNoDelay(true);
      req.socket.setTimeout(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).setTimeout?.(0);
    } catch {
      // ignore
    }

    // Important headers for SSE.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    // Some proxies buffer by default.
    res.setHeader('X-Accel-Buffering', 'no');

    // Flush headers if supported (depends on runtime).
    if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders();

    const userId = String(req.auth?.userId || '');
    const roles = (req.auth?.roles || []) as Role[];
    const mediatorCode = String((req.auth?.user as any)?.mediatorCode || '').trim();
    const parentCode = String((req.auth?.user as any)?.parentCode || '').trim();
    const brandCode = String((req.auth?.user as any)?.brandCode || '').trim();

    const normalizeCode = (value: string) => value.trim().toLowerCase();
    const mediatorCodeNorm = normalizeCode(mediatorCode);
    const parentCodeNorm = normalizeCode(parentCode);
    const brandCodeNorm = normalizeCode(brandCode);

    let cleaned = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        if (ping) clearInterval(ping);
      } catch {
        // ignore
      }
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
      try {
        res.end();
      } catch {
        // ignore
      }
    };

    // Initial handshake.
    try {
      res.write(': connected\n\n');
      if (typeof (res as any).flush === 'function') (res as any).flush();
    } catch {
      cleanup();
      return;
    }

    if (!writeSse(res, { event: 'ready', data: { ts: new Date().toISOString() } })) {
      cleanup();
      return;
    }

    unsubscribe = subscribeRealtime((evt) => {
      const aud = evt.audience;
      const baseAllowed = shouldDeliver(evt, { userId, roles });
      if (!baseAllowed && aud) {
        // Additional scoping for multi-tenant data. These are evaluated in addition
        // to userIds/roles so we can target events to the *specific* agency/mediator/brand.
        const allowByAgency =
          roles.includes('agency') &&
          Array.isArray(aud.agencyCodes) &&
          aud.agencyCodes.map((c) => String(c || '').trim().toLowerCase()).includes(mediatorCodeNorm);
        const allowByMediator =
          roles.includes('mediator') &&
          Array.isArray(aud.mediatorCodes) &&
          aud.mediatorCodes.map((c) => String(c || '').trim().toLowerCase()).includes(mediatorCodeNorm);
        const allowByBrand =
          roles.includes('brand') &&
          Array.isArray(aud.brandCodes) &&
          aud.brandCodes.map((c) => String(c || '').trim().toLowerCase()).includes(brandCodeNorm);
        const allowByParent =
          Array.isArray(aud.parentCodes) &&
          aud.parentCodes.map((c) => String(c || '').trim().toLowerCase()).includes(parentCodeNorm);

        if (!(allowByAgency || allowByMediator || allowByBrand || allowByParent)) return;
      } else if (!baseAllowed) {
        return;
      }
      if (!writeSse(res, { event: evt.type, data: { ts: evt.ts, payload: evt.payload } })) {
        cleanup();
      }
    });

    // Keepalive ping so intermediaries don’t close idle connections.
    ping = setInterval(() => {
      if (!writeSse(res, { event: 'ping', data: { ts: new Date().toISOString() } })) {
        cleanup();
      }
    }, 25_000);

    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  });

  return r;
}
