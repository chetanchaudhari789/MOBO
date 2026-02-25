import { Router } from 'express';

import type { Env } from '../config/env.js';
import { prisma, isPrismaAvailable, pingPg } from '../database/prisma.js';

async function isHttpOk(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function hasE2EUsers(): Promise<boolean> {
  // Must match the accounts seeded by backend/seeds/e2e.ts
  const requiredMobiles = ['9000000000', '9000000001', '9000000002', '9000000003', '9000000004', '9000000005'];

  if (isPrismaAvailable()) {
    try {
      const count = await prisma().user.count({
        where: { mobile: { in: requiredMobiles }, deletedAt: null },
      });
      if (count >= requiredMobiles.length) return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function healthRoutes(env: Env): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    // Check PostgreSQL health with actual connectivity ping
    const pgOk = await pingPg();

    // Include uptime and memory for production monitoring
    const uptimeSec = Math.floor(process.uptime());
    const memMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);

    res.status(pgOk ? 200 : 503).json({
      status: pgOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: uptimeSec,
      memoryMB: memMB,
      database: {
        status: pgOk ? 'connected' : 'disconnected',
        postgres: { status: pgOk ? 'connected' : 'disconnected' },
      },
    });
  });

  // Playwright uses this endpoint as the single source of readiness truth.
  // It is intentionally conservative: only returns 200 once the DB is connected,
  // the E2E seed accounts exist (when SEED_E2E), and all portal dev servers are responding.
  router.get('/health/e2e', async (_req, res) => {
    // Production guard: do not expose internal topology in production.
    if (env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    try {
      // Check PG connectivity
      const pgOk = await pingPg();
      const dbOk = pgOk;

      const portals = [
        { name: 'buyer', url: 'http://127.0.0.1:3001/' },
        { name: 'mediator', url: 'http://127.0.0.1:3002/' },
        { name: 'agency', url: 'http://127.0.0.1:3003/' },
        { name: 'brand', url: 'http://127.0.0.1:3004/' },
        { name: 'admin', url: 'http://127.0.0.1:3005/' },
      ];

      const [buyerOk, mediatorOk, agencyOk, brandOk, adminOk] = await Promise.all(
        portals.map((p) => isHttpOk(p.url))
      );

      const e2eUsersOk = env.NODE_ENV === 'test' ? await hasE2EUsers() : true;

      const allOk = dbOk && buyerOk && mediatorOk && agencyOk && brandOk && adminOk && e2eUsersOk;

      res.status(allOk ? 200 : 503).json({
        status: allOk ? 'ok' : 'starting',
        database: { ok: dbOk, postgres: pgOk },
        seed: { e2eUsersOk },
        portals: {
          buyer: buyerOk,
          mediator: mediatorOk,
          agency: agencyOk,
          brand: brandOk,
          admin: adminOk,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({ status: 'error', message: String(err) });
    }
  });
  return router;
}
