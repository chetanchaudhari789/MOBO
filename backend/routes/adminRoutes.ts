import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { makeInviteController } from '../controllers/inviteController.js';
import { makeAdminController } from '../controllers/adminController.js';

export function adminRoutes(env: Env): Router {
  const router = Router();
  const invites = makeInviteController();
  const admin = makeAdminController();

  router.use(requireAuth(env));
  router.use(requireRoles('admin'));

  const adminLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === 'production' ? 900 : 10_000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        requestId,
      });
    },
  });
  router.use(adminLimiter);

  router.get('/invites', invites.adminListInvites);
  router.post('/invites', invites.adminCreateInvite);
  router.post('/invites/revoke', invites.adminRevokeInvite);
  router.delete('/invites/:code', invites.adminDeleteInvite);

  router.get('/config', admin.getSystemConfig);
  router.patch('/config', admin.updateSystemConfig);

  router.get('/users', admin.getUsers);
  router.get('/financials', admin.getFinancials);
  router.get('/stats', admin.getStats);
  router.get('/growth', admin.getGrowth);
  router.get('/products', admin.getProducts);
  router.patch('/users/status', admin.updateUserStatus);

  router.post('/orders/reactivate', admin.reactivateOrder);

  return router;
}
