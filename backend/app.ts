import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import type { Env } from './config/env.js';
import { parseCorsOrigins } from './config/env.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { opsRoutes } from './routes/opsRoutes.js';
import { productsRoutes } from './routes/productsRoutes.js';
import { aiRoutes } from './routes/aiRoutes.js';
import { ordersRoutes } from './routes/ordersRoutes.js';
import { ticketsRoutes } from './routes/ticketsRoutes.js';
import { brandRoutes } from './routes/brandRoutes.js';
import { notificationsRoutes } from './routes/notificationsRoutes.js';
import { realtimeRoutes } from './routes/realtimeRoutes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp(env: Env) {
  const app = express();

  app.disable('x-powered-by');

  // Most deployments (Render/Vercel/NGINX) run behind a reverse proxy.
  // This ensures `req.ip` and rate-limits behave correctly.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Lightweight request logging (kept dependency-free).
  // Disabled in tests to avoid noisy output.
  if (env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        // eslint-disable-next-line no-console
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
      });
      next();
    });
  }
  app.use(helmet());

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'production' ? 300 : 10_000,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS);
  app.use(
    cors({
      origin: corsOrigins.length ? corsOrigins : true,
      credentials: true,
    })
  );

  app.use(express.json({ limit: '10mb' }));

  app.use('/api', healthRoutes(env));
  app.use('/api/auth', authRoutes(env));
  app.use('/api/admin', adminRoutes(env));
  app.use('/api/ops', opsRoutes(env));
  app.use('/api/brand', brandRoutes(env));
  app.use('/api', productsRoutes(env));
  app.use('/api', ordersRoutes(env));
  app.use('/api', ticketsRoutes(env));
  app.use('/api/notifications', notificationsRoutes(env));
  app.use('/api/realtime', realtimeRoutes(env));
  app.use('/api/ai', aiRoutes(env));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
