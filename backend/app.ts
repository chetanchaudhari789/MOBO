import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';

import type { Env } from './config/env.js';
import { parseCorsOrigins } from './config/env.js';
import { httpLog } from './config/logger.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { opsRoutes } from './routes/opsRoutes.js';
import { productsRoutes } from './routes/productsRoutes.js';
import { aiRoutes } from './routes/aiRoutes.js';
import { sheetsRoutes } from './routes/sheetsRoutes.js';
import { googleRoutes } from './routes/googleRoutes.js';
import { ordersRoutes } from './routes/ordersRoutes.js';
import { ticketsRoutes } from './routes/ticketsRoutes.js';
import { brandRoutes } from './routes/brandRoutes.js';
import { notificationsRoutes } from './routes/notificationsRoutes.js';
import { realtimeRoutes } from './routes/realtimeRoutes.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { securityAuditMiddleware, responseTimingMiddleware } from './middleware/security.js';
import { mediaRoutes } from './routes/mediaRoutes.js';
import { initAiServiceConfig } from './services/aiService.js';

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (!origin) return true;
  if (!allowed.length) return true;
  if (allowed.includes('*')) return true;

  let originUrl: URL | null = null;
  try {
    originUrl = new URL(origin);
  } catch {
    // If Origin is not a valid URL, fail closed.
    return false;
  }

  const originHost = originUrl.hostname;

  return allowed.some((entryRaw) => {
    const entry = String(entryRaw || '').trim();
    if (!entry) return false;

    // Exact match (full origin string).
    if (!entry.includes('*') && (entry.startsWith('http://') || entry.startsWith('https://'))) {
      return entry === origin;
    }

    // Wildcard support.
    // Examples:
    // - https://*.vercel.app
    // - *.vercel.app
    // - https://mobobuyer.vercel.app
    if (entry.includes('*')) {
      const escaped = entry
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const re = new RegExp(`^${escaped}$`);
      return re.test(origin) || re.test(originHost);
    }

    // Hostname-only entry support.
    // Examples:
    // - mobobuyer.vercel.app
    // - .vercel.app (suffix)
    if (entry.startsWith('.')) return originHost.endsWith(entry);
    return originHost === entry;
  });
}

export function createApp(env: Env) {
  const app = express();

  // Sync AI service config from env (OCR pool size, circuit breaker thresholds)
  initAiServiceConfig(env);

  app.disable('x-powered-by');

  // Response timing headers for performance monitoring.
  app.use(responseTimingMiddleware());

  // Ensure every response carries a request identifier for log correlation.
  // If a caller provides X-Request-Id, we echo it back (within a safe length).
  app.use((req, res, next) => {
    const provided = String(req.header('x-request-id') || '').trim();
    const requestId = provided && provided.length <= 128 ? provided : crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    res.locals.requestId = requestId;
    next();
  });

  // Most deployments (Render/Vercel/NGINX) run behind a reverse proxy.
  // This ensures `req.ip` and rate-limits behave correctly.
  app.set('trust proxy', 1);

  // Structured request logging via Winston.
  // Silent in tests (Winston logger is configured to be silent in test mode).
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      httpLog.log(level, `${req.method} ${req.originalUrl} -> ${status}`, {
        requestId: String(res.locals.requestId || ''),
        durationMs: ms,
        method: req.method,
        url: req.originalUrl,
        status,
        ip: req.ip,
      });
    });
    next();
  });
  // Helmet defaults are good, but for an API service we explicitly:
  // - disable CSP (frontends are served separately)
  // - only enable HSTS in production
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: env.NODE_ENV === 'production',
    })
  );

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === 'production' ? 300 : 10_000,
      standardHeaders: true,
      legacyHeaders: false,
      // Exempt SSE stream from rate limit — it's a single long-lived connection.
      skip: (req) => req.path === '/api/realtime/stream' || req.path === '/api/realtime/health',
      handler: (_req, res) => {
        const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
        httpLog.warn('Rate limit exceeded', { requestId, ip: _req.ip });
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
          requestId,
        });
      },
    })
  );

  // Stricter limiter for authentication endpoints to reduce brute-force risk.
  const authLimiter = rateLimit({
    windowMs: 5 * 60_000,
    limit: env.NODE_ENV === 'production' ? 50 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS);

  // If a request presents an Origin header and it is not allowed, fail closed.
  // This complements the CORS middleware (which otherwise may simply omit headers
  // while still allowing the request to be processed server-side).
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && !isOriginAllowed(origin, corsOrigins)) {
      return res.status(403).json({
        error: 'origin_not_allowed',
        requestId: String(res.locals.requestId || ''),
      });
    }
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isOriginAllowed(String(origin || ''), corsOrigins)),
      credentials: true,
      optionsSuccessStatus: 204,
    })
  );

  // Skip body parsers for SSE stream — no request body and parsers can interfere
  // with long-lived streaming connections (a common cause of 400 errors on SSE).
  const skipBodyParser = (req: express.Request) =>
    req.path.startsWith('/api/realtime/');
  app.use((req, res, next) => {
    if (skipBodyParser(req)) return next();
    express.json({ limit: env.REQUEST_BODY_LIMIT })(req, res, next);
  });
  app.use((req, res, next) => {
    if (skipBodyParser(req)) return next();
    express.urlencoded({ extended: false, limit: env.REQUEST_BODY_LIMIT })(req, res, next);
  });

  // Security audit: log suspicious patterns in requests (after body parsing).
  // Only active in production to avoid dev noise.
  if (env.NODE_ENV === 'production') {
    app.use(securityAuditMiddleware());
  }

  app.use('/api', healthRoutes(env));
  app.use('/api/auth', authLimiter, authRoutes(env));
  app.use('/api/admin', adminRoutes(env));
  app.use('/api/ops', opsRoutes(env));
  app.use('/api/brand', brandRoutes(env));
  app.use('/api', productsRoutes(env));
  app.use('/api', ordersRoutes(env));
  app.use('/api', ticketsRoutes(env));
  app.use('/api/notifications', notificationsRoutes(env));
  app.use('/api/realtime', realtimeRoutes(env));
  app.use('/api', mediaRoutes(env));
  app.use('/api/ai', aiRoutes(env));
  app.use('/api/sheets', sheetsRoutes(env));
  app.use('/api/google', googleRoutes(env));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
