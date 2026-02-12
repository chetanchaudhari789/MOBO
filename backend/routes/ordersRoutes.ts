import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { OrderModel } from '../models/Order.js';
import { UserModel } from '../models/User.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { AppError } from '../middleware/errors.js';

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

  // Audit trail for a specific order — restricted to admin/ops roles, or users with access to the order
  router.get('/orders/:orderId/audit', requireAuth(env), async (req, res, next) => {
    try {
      const { orderId } = req.params;
      
      // Find the order first
      const order = await OrderModel.findById(orderId).lean();
      if (!order || order.deletedAt) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
      }

      // Check authorization - same logic as getOrderProof
      const { roles, user, userId } = getRequester(req);
      if (!isPrivileged(roles)) {
        let allowed = false;

        if (roles.includes('brand')) {
          const sameBrand = String(order.brandUserId || '') === String(user?._id || userId);
          const brandName = String(order.brandName || '').trim();
          const sameBrandName = !!brandName && brandName === String(user?.name || '').trim();
          allowed = sameBrand || sameBrandName;
        }

        if (!allowed && roles.includes('agency')) {
          const agencyCode = String(user?.mediatorCode || '').trim();
          const agencyName = String(user?.name || '').trim();
          if (agencyName && String(order.agencyName || '').trim() === agencyName) {
            allowed = true;
          } else if (agencyCode && String(order.managerName || '').trim()) {
            const mediator = await UserModel.findOne({
              roles: 'mediator',
              mediatorCode: String(order.managerName || '').trim(),
              parentCode: agencyCode,
              deletedAt: null,
            })
              .select({ _id: 1 })
              .lean();
            allowed = !!mediator;
          }
        }

        if (!allowed && roles.includes('mediator')) {
          const mediatorCode = String(user?.mediatorCode || '').trim();
          allowed = !!mediatorCode && String(order.managerName || '').trim() === mediatorCode;
        }

        if (!allowed && roles.includes('shopper')) {
          allowed = String(order.userId || '') === String(user?._id || userId);
        }

        if (!allowed) {
          throw new AppError(403, 'FORBIDDEN', 'Not allowed to access audit logs for this order');
        }
      }

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
