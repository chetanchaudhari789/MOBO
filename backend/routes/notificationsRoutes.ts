import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { makeNotificationsController } from '../controllers/notificationsController.js';

export function notificationsRoutes(env: Env): Router {
  const router = Router();
  const controller = makeNotificationsController();

  router.get('/', requireAuth(env), controller.list);

  return router;
}
