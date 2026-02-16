import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { makeBrandController } from '../controllers/brandController.js';

export function brandRoutes(env: Env): Router {
  const router = Router();
  const brand = makeBrandController();

  router.use(requireAuth(env));
  router.use(requireRoles('brand', 'admin', 'ops'));

  // Rate limiting for brand endpoints to prevent abuse
  const brandLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === 'production' ? 300 : 10_000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(brandLimiter);

  // Stricter rate limit for financial/write endpoints
  const financialLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'production' ? 10 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/agencies', brand.getAgencies);
  router.get('/campaigns', brand.getCampaigns);
  router.get('/orders', brand.getOrders);
  router.get('/transactions', brand.getTransactions);

  router.post('/payout', financialLimiter, brand.payoutAgency);
  router.post('/requests/resolve', brand.resolveRequest);
  router.post('/agencies/remove', brand.removeAgency);

  router.post('/campaigns', brand.createCampaign);
  router.post('/campaigns/copy', brand.copyCampaign);
  router.patch('/campaigns/:campaignId', brand.updateCampaign);
  router.delete('/campaigns/:campaignId', brand.deleteCampaign);

  return router;
}
