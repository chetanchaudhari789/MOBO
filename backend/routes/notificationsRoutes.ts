import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { makeNotificationsController } from '../controllers/notificationsController.js';
import { makePushNotificationsController } from '../controllers/pushNotificationsController.js';

export function notificationsRoutes(env: Env): Router {
  const router = Router();
  const controller = makeNotificationsController();
  const push = makePushNotificationsController(env);

  router.get('/', requireAuth(env), controller.list);

  router.get('/push/public-key', push.publicKey);
  router.post('/push/subscribe', requireAuth(env), push.subscribe);
  router.delete('/push/subscribe', requireAuth(env), push.unsubscribe);

  return router;
}
