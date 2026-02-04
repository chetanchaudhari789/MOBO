import { Router } from 'express';
import type { Env } from '../config/env.js';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function mediaRoutes(_env: Env): Router {
  const router = Router();

  router.get('/media/image', async (req, res) => {
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
