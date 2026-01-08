import { Router } from 'express';
import type { Env } from '../config/env.js';
import { makeAuthController } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

export function authRoutes(env: Env): Router {
  const router = Router();
  const controller = makeAuthController(env);

  router.post('/register', controller.register);
  router.post('/login', controller.login);

  router.get('/me', requireAuth(env), controller.me);

  router.post('/register-ops', controller.registerOps);
  router.post('/register-brand', controller.registerBrand);
  router.patch('/profile', requireAuth(env), controller.updateProfile);

  return router;
}
