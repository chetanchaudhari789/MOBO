import { Router } from 'express';
import mongoose from 'mongoose';

<<<<<<< HEAD
import type { Env } from '../config/env.js';
import { UserModel } from '../models/User.js';

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
  const count = await UserModel.countDocuments({ mobile: { $in: requiredMobiles }, deletedAt: null });
  return count >= requiredMobiles.length;
}

export function healthRoutes(env: Env): Router {
=======
export function healthRoutes(): Router {
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  const router = Router();

  router.get('/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatusMap: Record<number, string> = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };
    const dbStatus = dbStatusMap[dbState] || 'unknown';

    const isHealthy = dbState === 1;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        readyState: dbState,
      },
    });
  });

<<<<<<< HEAD
  // Playwright uses this endpoint as the single source of readiness truth.
  // It is intentionally conservative: only returns 200 once the DB is connected,
  // the E2E seed accounts exist (when SEED_E2E), and all portal dev servers are responding.
  router.get('/health/e2e', async (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbOk = dbState === 1;

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

    const e2eUsersOk = env.SEED_E2E ? await hasE2EUsers() : true;

    const allOk = dbOk && buyerOk && mediatorOk && agencyOk && brandOk && adminOk && e2eUsersOk;

    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'starting',
      database: { ok: dbOk, readyState: dbState },
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
  });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  return router;
}
