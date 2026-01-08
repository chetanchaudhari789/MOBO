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
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp(env: Env) {
  const app = express();

  app.disable('x-powered-by');

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

  app.use('/api', healthRoutes());
  app.use('/api/auth', authRoutes(env));
  app.use('/api/admin', adminRoutes(env));
  app.use('/api/ops', opsRoutes(env));
  app.use('/api/brand', brandRoutes(env));
  app.use('/api', productsRoutes(env));
  app.use('/api', ordersRoutes(env));
  app.use('/api', ticketsRoutes(env));
  app.use('/api/ai', aiRoutes(env));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
