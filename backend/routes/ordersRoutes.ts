import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth, requireAuthOrToken } from '../middleware/auth.js';
import { makeOrdersController } from '../controllers/ordersController.js';

export function ordersRoutes(env: Env): Router {
  const router = Router();
  const orders = makeOrdersController();

  // UI expects these endpoints to exist.
  router.get('/orders/user/:userId', requireAuth(env), orders.getUserOrders);
  router.post('/orders', requireAuth(env), orders.createOrder);
  router.post('/orders/claim', requireAuth(env), orders.submitClaim);
  router.get('/orders/:orderId/proof/:type', requireAuthOrToken(env), orders.getOrderProof);
  router.get('/public/orders/:orderId/proof/:type', orders.getOrderProofPublic);

  return router;
}
