import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { OrderModel } from '../models/Order.js';
import { UserModel } from '../models/User.js';

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

  // Authorization middleware: ensure users can only access their own orders
  // Only admin/ops are truly privileged; other roles are checked in the controller
  const ownerOrPrivileged = (req: any, res: any, next: any) => {
    const requestedUserId = req.params.userId;
    const auth = req.auth;
    const roles: string[] = auth?.roles ?? [];
    const isPrivileged = roles.some((r: string) => ['admin', 'ops'].includes(r));
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
  // Public proof endpoint removed — use authenticated endpoint above.
  // Old: router.get('/public/orders/:orderId/proof/:type', publicProofLimiter, orders.getOrderProofPublic);

  // Audit trail for a specific order — privileged roles or the order owner (buyer)
  // Agency/mediator users are scoped to orders within their lineage.
  router.get('/orders/:orderId/audit', requireAuth(env), async (req, res, next) => {
    try {
      const roles: string[] = (req as any).auth?.roles ?? [];
      const userId: string = (req as any).auth?.userId ?? '';
      const isAdmin = roles.some((r: string) => ['admin', 'ops'].includes(r));

      const orderId = String(req.params.orderId);
      // Validate orderId is a proper ObjectId to prevent CastError 500s
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid orderId format' } });
      }

      // Everyone except admin/ops must pass ownership checks
      if (!isAdmin) {
        const order = await OrderModel.findById(orderId).select('userId brandUserId agencyName managerName').lean() as any;
        if (!order) {
          return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
        }

        let allowed = false;

        if (roles.includes('shopper')) {
          allowed = String(order.userId) === userId;
        }

        if (!allowed && roles.includes('brand')) {
          const user = await UserModel.findById(userId).select('name').lean() as any;
          const sameBrandId = String(order.brandUserId || '') === userId;
          const sameBrandName = !!user?.name && String(order.brandName || '').trim() === String(user.name || '').trim();
          allowed = sameBrandId || sameBrandName;
        }

        if (!allowed && roles.includes('agency')) {
          const user = await UserModel.findById(userId).select('mediatorCode name').lean() as any;
          const agencyName = String(user?.name || '').trim();
          const agencyCode = String(user?.mediatorCode || '').trim();
          if (agencyName && String(order.agencyName || '').trim() === agencyName) {
            allowed = true;
          } else if (agencyCode && order.managerName) {
            const mediator = await UserModel.findOne({
              roles: 'mediator',
              mediatorCode: String(order.managerName).trim(),
              parentCode: agencyCode,
              deletedAt: null,
            }).select('_id').lean();
            allowed = !!mediator;
          }
        }

        if (!allowed && roles.includes('mediator')) {
          const user = await UserModel.findById(userId).select('mediatorCode').lean() as any;
          const mediatorCode = String(user?.mediatorCode || '').trim();
          allowed = !!mediatorCode && String(order.managerName || '').trim() === mediatorCode;
        }

        if (!allowed) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role for audit access' } });
        }
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

      // Also return inline order.events for a combined timeline
      const orderDoc = await OrderModel.findById(orderId).select('events').lean();
      const events = Array.isArray((orderDoc as any)?.events) ? (orderDoc as any).events : [];

      res.json({ logs, events, page, limit });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
