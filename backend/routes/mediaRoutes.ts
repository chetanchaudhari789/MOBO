import { Router } from 'express';
import type { Env } from '../config/env.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Simple per-IP rate limiter for the public image proxy.
 * Allows `MAX_REQUESTS` requests per `WINDOW_MS` window per IP.
 */
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 120; // generous limit for pages with many product cards
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX_REQUESTS;
}

// Periodically clean up stale entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now >= entry.resetAt) ipHits.delete(ip);
  }
}, RATE_WINDOW_MS * 2).unref();

/** Block requests to private / link-local / loopback addresses (SSRF protection). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  // Loopback
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
  // Block encoded forms of loopback (e.g. 0x7f000001, 0177.0.0.1)
  if (/^0[xo]/.test(h) || /^\d+$/.test(h)) return true;
  // IPv6 private / link-local ranges
  if (h.startsWith('[')) {
    const inner = h.slice(1, -1);
    // fc00::/7 (unique local), fe80::/10 (link-local), ::1 (loopback)
    if (/^f[cd]/i.test(inner) || /^fe[89ab]/i.test(inner) || inner === '::1') return true;
  }
  // RFC-1918 / link-local / metadata (IPv4)
  const parts = hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // AWS metadata etc.
    if (parts[0] === 127) return true; // entire 127.0.0.0/8
    if (parts[0] === 0) return true;
  }
  // Block cloud metadata hostnames
  if (h === 'metadata.google.internal' || h === 'metadata.google.com') return true;
  return false;
}

export function mediaRoutes(_env: Env): Router {
  const router = Router();

  // Public endpoint — <img src="..."> tags cannot send Authorization headers.
  // SSRF protection (isPrivateHost) + per-IP rate limiting keep this safe.
  router.get('/media/image', async (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    if (isRateLimited(clientIp)) {
      res.set('Retry-After', String(Math.ceil(RATE_WINDOW_MS / 1000)));
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'rate limit exceeded' } });
      return;
    }
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'url required' } });
      return;
    }

    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'invalid url' } });
      return;
    }

    if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'invalid protocol' } });
      return;
    }

    if (isPrivateHost(target.hostname)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'private addresses not allowed' } });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: 'manual',  // Prevent SSRF via open-redirect chains
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BUZZMA/1.0)',
          Accept: 'image/*,*/*;q=0.8',
        },
      });

      // If the upstream redirects, validate the redirect target before following.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          try {
            const redirectTarget = new URL(location, target.toString());
            if (!ALLOWED_PROTOCOLS.has(redirectTarget.protocol) || isPrivateHost(redirectTarget.hostname)) {
              res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'unsafe redirect target' } });
              return;
            }
          } catch {
            // Invalid redirect URL
          }
        }
        res.status(404).end();
        return;
      }

      if (!response.ok || !response.body) {
        res.status(404).end();
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength && contentLength > MAX_IMAGE_BYTES) {
        res.status(413).end();
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
        res.status(413).end();
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(404).end();
    } finally {
      clearTimeout(timeout);
    }
  });

  return router;
}
