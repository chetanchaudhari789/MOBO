import { Router } from 'express';
import mongoose from 'mongoose';

export function healthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatusMap: Record<number, string> = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    };
    const dbStatus = dbStatusMap[dbState] || 'unknown';

    const isHealthy = dbState === 1;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        readyState: dbState,
      },
    });
  });

  return router;
}
