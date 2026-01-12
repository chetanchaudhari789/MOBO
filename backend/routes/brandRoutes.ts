import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { makeBrandController } from '../controllers/brandController.js';

export function brandRoutes(env: Env): Router {
  const router = Router();
  const brand = makeBrandController();

  router.use(requireAuth(env));
  router.use(requireRoles('brand', 'admin', 'ops'));

  router.get('/agencies', brand.getAgencies);
  router.get('/campaigns', brand.getCampaigns);
  router.get('/orders', brand.getOrders);
  router.get('/transactions', brand.getTransactions);

  router.post('/payout', brand.payoutAgency);
  router.post('/requests/resolve', brand.resolveRequest);
  router.post('/agencies/remove', brand.removeAgency);

  router.post('/campaigns', brand.createCampaign);
  router.patch('/campaigns/:campaignId', brand.updateCampaign);

  return router;
}
