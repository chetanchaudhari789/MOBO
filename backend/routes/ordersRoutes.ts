import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';
import { AuditLogModel } from '../models/AuditLog.js';

export function ordersRoutes(env: Env): Router {
  const router = Router();
  const orders = makeOrdersController(env);

  // Rate limit for authenticated order endpoints to prevent abuse
  const orderWriteLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'production' ? 30 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Stricter rate-limit for the unauthenticated public proof endpoint
  // to prevent enumeration / data-scraping of buyer proof images.
  const publicProofLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'production' ? 30 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Authorization middleware: ensure users can only access their own orders
  const ownerOrPrivileged = (req: any, res: any, next: any) => {
    const requestedUserId = req.params.userId;
    const auth = req.auth;
    const roles: string[] = auth?.roles ?? [];
    const isPrivileged = roles.some((r: string) => ['admin', 'ops', 'agency', 'mediator', 'brand'].includes(r));
    if (!isPrivileged && auth?.userId !== requestedUserId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
    next();
  };

  // UI expects these endpoints to exist.
  router.get('/orders/user/:userId', requireAuth(env), ownerOrPrivileged, orders.getUserOrders);
  router.post('/orders', requireAuth(env), orderWriteLimiter, orders.createOrder);
  router.post('/orders/claim', requireAuth(env), orderWriteLimiter, orders.submitClaim);
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

      const orderId = String(req.params.orderId);
      // Validate orderId is a proper ObjectId to prevent CastError 500s
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid orderId format' } });
      }

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      const logs = await AuditLogModel.find({
        entityType: 'Order',
        entityId: orderId,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      res.json({ logs, page, limit });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
