import { Router } from 'express';
import type { Env } from '../config/env.js';
import { makeProductsController } from '../controllers/productsController.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';

export function productsRoutes(env: Env): Router {
  const router = Router();
  const controller = makeProductsController();

  router.get('/products', requireAuth(env), requireRoles('shopper'), (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, max-age=60');
    next();
  }, controller.listProducts);

  // Redirect tracking: returns a URL + creates a REDIRECTED pre-order.
  router.post('/deals/:dealId/redirect', requireAuth(env), requireRoles('shopper'), controller.trackRedirect);

  return router;
}
