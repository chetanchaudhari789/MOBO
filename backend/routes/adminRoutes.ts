import { Router } from 'express';
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

  router.get('/invites', invites.adminListInvites);
  router.post('/invites', invites.adminCreateInvite);
  router.post('/invites/revoke', invites.adminRevokeInvite);


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
