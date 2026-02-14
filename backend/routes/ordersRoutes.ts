import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { OrderModel } from '../models/Order.js';

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

  // Audit trail for a specific order — privileged roles or the order owner (buyer)
  router.get('/orders/:orderId/audit', requireAuth(env), async (req, res, next) => {
    try {
      const roles: string[] = (req as any).auth?.roles ?? [];
      const userId: string = (req as any).auth?.userId ?? '';
      const privileged = roles.some((r: string) => ['admin', 'ops', 'agency', 'mediator'].includes(r));

      const orderId = String(req.params.orderId);
      // Validate orderId is a proper ObjectId to prevent CastError 500s
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid orderId format' } });
      }

      // Non-privileged users (buyers) may only view audit for their own orders
      // Fetch order with both userId (for ownership check) and events (for timeline)
      const order = await OrderModel.findById(orderId).select('userId events').lean();
      if (!order) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      if (!privileged && String(order.userId) !== userId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role for audit access' } });
      }

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const skip = (page - 1) * limit;

      // Fetch AuditLog entries for this order
      const logs = await AuditLogModel.find({
        entityType: 'Order',
        entityId: orderId,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // Use the already-fetched order.events
      const rawEvents = Array.isArray((order as any)?.events) ? (order as any).events : [];
      const events = rawEvents.map((event: any) => ({
        type: event?.type,
        at: event?.at,
        metadata: event?.metadata,
      }));

      res.json({ logs, events, page, limit });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
