import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';
import { AuditLogModel } from '../models/AuditLog.js';

export function ordersRoutes(env: Env): Router {
  const router = Router();
  const orders = makeOrdersController(env);

  // Stricter rate-limit for the unauthenticated public proof endpoint
  // to prevent enumeration / data-scraping of buyer proof images.
  const publicProofLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'production' ? 30 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // UI expects these endpoints to exist.
  router.get('/orders/user/:userId', requireAuth(env), orders.getUserOrders);
  router.post('/orders', requireAuth(env), orders.createOrder);
  router.post('/orders/claim', requireAuth(env), orders.submitClaim);
  router.get('/orders/:orderId/proof/:type', requireAuthOrToken(env), orders.getOrderProof);
  router.get('/public/orders/:orderId/proof/:type', publicProofLimiter, orders.getOrderProofPublic);

  // Audit trail for a specific order — restricted to admin/ops/agency/mediator roles
  router.get('/orders/:orderId/audit', requireAuth(env), async (req, res, next) => {
    try {
      const roles: string[] = (req as any).auth?.roles ?? [];
      const privileged = roles.some((r: string) => ['admin', 'ops', 'agency', 'mediator'].includes(r));
      if (!privileged) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role for audit access' } });
      }

      const { orderId } = req.params;
      const logs = await AuditLogModel.find({
        entityType: 'Order',
        entityId: orderId,
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      res.json({ logs });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
