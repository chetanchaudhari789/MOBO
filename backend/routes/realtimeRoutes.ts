import { Router } from 'express';
import type { Env } from '../config/env.js';
import type { Role } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { subscribeRealtime, type RealtimeEvent } from '../services/realtimeHub.js';

function writeSse(res: any, evt: { event: string; data?: any }) {
  res.write(`event: ${evt.event}\n`);
  if (typeof evt.data !== 'undefined') {
    const payload = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data);
    // SSE allows multi-line data; keep it single-line JSON.
    res.write(`data: ${payload}\n`);
  }
  res.write('\n');
}

function shouldDeliver(evt: RealtimeEvent, ctx: { userId: string; roles: Role[] }): boolean {
  const aud = evt.audience;
  if (!aud || aud.broadcast) return true;
  if (Array.isArray(aud.userIds) && aud.userIds.includes(ctx.userId)) return true;
  if (Array.isArray(aud.roles) && aud.roles.some((r) => ctx.roles.includes(r))) return true;
  return false;
}

export function realtimeRoutes(env: Env) {
  const r = Router();

  // Streaming endpoint for realtime UI updates.
  // Auth is via standard Bearer token header (same as REST routes).
  r.get('/stream', requireAuth(env), (req, res) => {
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

    // Initial handshake.
    res.write(': connected\n\n');
    writeSse(res, { event: 'ready', data: { ts: new Date().toISOString() } });

    const unsubscribe = subscribeRealtime((evt) => {
      const aud = evt.audience;
      const baseAllowed = shouldDeliver(evt, { userId, roles });
      if (!baseAllowed && aud) {
        // Additional scoping for multi-tenant data. These are evaluated in addition
        // to userIds/roles so we can target events to the *specific* agency/mediator/brand.
        const allowByAgency =
          roles.includes('agency') && Array.isArray(aud.agencyCodes) && aud.agencyCodes.includes(mediatorCode);
        const allowByMediator =
          roles.includes('mediator') && Array.isArray(aud.mediatorCodes) && aud.mediatorCodes.includes(mediatorCode);
        const allowByBrand =
          roles.includes('brand') && Array.isArray(aud.brandCodes) && aud.brandCodes.includes(brandCode);
        const allowByParent = Array.isArray(aud.parentCodes) && aud.parentCodes.includes(parentCode);

        if (!(allowByAgency || allowByMediator || allowByBrand || allowByParent)) return;
      } else if (!baseAllowed) {
        return;
      }
      writeSse(res, { event: evt.type, data: { ts: evt.ts, payload: evt.payload } });
    });

    // Keepalive ping so intermediaries don’t close idle connections.
    const ping = setInterval(() => {
      writeSse(res, { event: 'ping', data: { ts: new Date().toISOString() } });
    }, 25_000);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };

    req.on('close', cleanup);
    req.on('aborted', cleanup);
  });

  return r;
}
