import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

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

export function mediaRoutes(env: Env): Router {
  const router = Router();

  // Auth required: prevents unauthenticated SSRF scanning.
  router.get('/media/image', requireAuth(env), async (req, res) => {
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
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BUZZMA/1.0)',
          Accept: 'image/*,*/*;q=0.8',
        },
      });

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
