import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { makeAuthController } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

export function authRoutes(env: Env): Router {
  const router = Router();
  const controller = makeAuthController(env);

  // Auth responses contain credentials/tokens; they must not be cached.
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: env.NODE_ENV === 'production' ? 60 : 10_000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });

  router.post('/register', authLimiter, controller.register);
  router.post('/login', authLimiter, controller.login);

  router.get('/me', requireAuth(env), controller.me);

  router.post('/register-ops', authLimiter, controller.registerOps);
  router.post('/register-brand', authLimiter, controller.registerBrand);
  router.patch('/profile', requireAuth(env), controller.updateProfile);

  return router;
}
