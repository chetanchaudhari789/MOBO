import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

import type { Env } from '../config/env.js';
import {
  checkGeminiApiKey,
  extractOrderDetailsWithAi,
  generateChatUiResponse,
  isGeminiConfigured,
  verifyProofWithAi,
} from '../services/aiService.js';
import { DealModel } from '../models/Deal.js';
import { toUiDeal } from '../utils/uiMappers.js';
import { buildMediatorCodeRegex, normalizeMediatorCode } from '../utils/mediatorCode.js';
import { optionalAuth, requireAuth, requireRoles } from '../middleware/auth.js';

export function aiRoutes(env: Env): Router {
  const router = Router();

  const chatSchema = z.object({
    message: z.string().max(env.AI_MAX_INPUT_CHARS).default(''),
    // Legacy UI fields (ignored server-side unless no auth is present)
    userId: z.string().optional(),
    userName: z.string().max(120).default('Guest'),
    products: z.array(z.any()).max(200).optional(),
    orders: z.array(z.any()).max(200).optional(),
    tickets: z.array(z.any()).max(200).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system']),
          content: z.string().max(env.AI_MAX_INPUT_CHARS),
        })
      )
      .max(20)
      .optional(),
    // data URL / base64; overall request size is also capped by express.json({limit:'10mb'})
    image: z.string().max(env.AI_MAX_IMAGE_CHARS).optional(),
  });

  const proofSchema = z.object({
    imageBase64: z.string().min(1).max(env.AI_MAX_IMAGE_CHARS),
    expectedOrderId: z.string().min(1),
    expectedAmount: z.number().finite(),
  });

  const extractOrderSchema = z.object({
    imageBase64: z.string().min(1).max(env.AI_MAX_IMAGE_CHARS),
  });

  // Optional auth so the UI can call AI routes without sending a token,
  // but if a token is provided we can trust user identity from DB.
  router.use(optionalAuth(env));

  // Tighten AI abuse surface beyond the global app limiter.
  // - Authenticated users get a higher quota.
  // - Unauthenticated requests are heavily throttled.
  const limiterChat = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      return req.auth?.userId ? env.AI_CHAT_RPM_AUTH : env.AI_CHAT_RPM_ANON;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
    handler: (_req, res) => {
      const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        requestId,
      });
    },
  });

  const limiterVerifyProof = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      return req.auth?.userId ? env.AI_PROOF_RPM_AUTH : env.AI_PROOF_RPM_ANON;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
    handler: (_req, res) => {
      const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        requestId,
      });
    },
  });

  const limiterExtractOrder = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      return req.auth?.userId ? env.AI_EXTRACT_RPM_AUTH : env.AI_EXTRACT_RPM_ANON;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
    handler: (_req, res) => {
      const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        requestId,
      });
    },
  });

  const getRequestId = (res: any) =>
    String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
  const dailyUsage = new Map<string, { day: string; count: number }>();
  const lastCallAt = new Map<string, number>();

  const ensureAiEnabled = (res: any): boolean => {
    if (env.AI_ENABLED) return true;
    res.status(503).json({
      error: { code: 'AI_DISABLED', message: 'AI is disabled' },
      requestId: getRequestId(res),
    });
    return false;
  };

  const enforceDailyLimit = (req: any, res: any): boolean => {
    if (env.NODE_ENV !== 'production') return true;
    const day = new Date().toISOString().slice(0, 10);
    const subject = String(req.auth?.userId || req.ip || 'unknown');
    const key = `${day}:${subject}`;
    const limit = req.auth?.userId ? env.AI_DAILY_LIMIT_AUTH : env.AI_DAILY_LIMIT_ANON;

    if (!Number.isFinite(limit) || limit <= 0) {
      res.status(429).json({
        error: { code: 'DAILY_LIMIT_REACHED', message: 'Daily AI quota exceeded' },
        requestId: getRequestId(res),
      });
      return false;
    }

    const existing = dailyUsage.get(key);
    if (!existing || existing.day !== day) {
      dailyUsage.set(key, { day, count: 1 });
      return true;
    }

    if (existing.count >= limit) {
      res.status(429).json({
        error: { code: 'DAILY_LIMIT_REACHED', message: 'Daily AI quota exceeded' },
        requestId: getRequestId(res),
      });
      return false;
    }

    existing.count += 1;
    return true;
  };

  const enforceMinInterval = (req: any, res: any): boolean => {
    if (env.NODE_ENV !== 'production') return true;
    if (!env.AI_MIN_SECONDS_BETWEEN_CALLS) return true;
    const subject = String(req.auth?.userId || req.ip || 'unknown');
    const now = Date.now();
    const last = lastCallAt.get(subject) || 0;
    if (now - last < env.AI_MIN_SECONDS_BETWEEN_CALLS * 1000) {
      res.status(429).json({
        error: { code: 'TOO_FREQUENT', message: 'Please wait before retrying' },
        requestId: getRequestId(res),
      });
      return false;
    }
    lastCallAt.set(subject, now);
    return true;
  };
  const sendKnownError = (err: unknown, res: any): boolean => {
    if (err instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error: { code: 'BAD_REQUEST', message: 'Invalid request', details: err.issues },
          requestId: getRequestId(res),
        });
      return true;
    }
    const anyErr = err as any;
    if (anyErr && typeof anyErr.statusCode === 'number') {
      const statusCode = anyErr.statusCode;
      const message = String(anyErr.message || 'AI error');
      const code =
        statusCode === 400
          ? 'BAD_REQUEST'
          : message.toLowerCase().includes('disabled')
            ? 'AI_DISABLED'
            : 'AI_NOT_CONFIGURED';
      res
        .status(statusCode)
        .json({
          error: {
            code,
            message,
          },
          requestId: getRequestId(res),
        });
      return true;
    }
    return false;
  };

  router.post('/chat', limiterChat, async (req, res, next) => {
    try {
      if (!ensureAiEnabled(res)) return;
      if (!enforceDailyLimit(req, res)) return;
      if (!enforceMinInterval(req, res)) return;
      const payload = chatSchema.parse(req.body);
      if (!isGeminiConfigured(env)) {
        res.status(503).json({
          error: { code: 'AI_NOT_CONFIGURED', message: 'Gemini is not configured.' },
          requestId: getRequestId(res),
        });
        return;
      }

      let effectiveProducts = payload.products;
      if (!Array.isArray(effectiveProducts) || effectiveProducts.length === 0) {
        const requester = req.auth?.user;
        const roles = req.auth?.roles ?? [];
        if (requester && roles.includes('shopper')) {
          const mediatorCode = normalizeMediatorCode((requester as any).parentCode);
          const mediatorRegex = buildMediatorCodeRegex(mediatorCode);
          if (mediatorRegex) {
            const deals = await DealModel.find({
              mediatorCode: mediatorRegex,
              active: true,
              deletedAt: null,
            })
              .sort({ createdAt: -1 })
              .limit(50)
              .lean();
            effectiveProducts = deals.map(toUiDeal);
          }
        }
      }

      // Zero-trust identity: never trust userId/userName from the client if auth is present.
      const authUser = req.auth?.user;
      const effectiveUserName = authUser ? String((authUser as any)?.name || 'User') : payload.userName;

      const slimProducts = Array.isArray(effectiveProducts)
        ? effectiveProducts.slice(0, 25).map((p: any) => ({
            id: p?.id,
            title: String(p?.title || '').slice(0, 120),
            price: Number(p?.price ?? 0),
            originalPrice: Number(p?.originalPrice ?? p?.price ?? 0),
            platform: String(p?.platform || '').slice(0, 40),
          }))
        : [];

      const slimOrders = Array.isArray(payload.orders)
        ? payload.orders.slice(0, 10).map((o: any) => ({
            id: o?.id,
            externalOrderId: o?.externalOrderId,
            status: o?.status,
            paymentStatus: o?.paymentStatus,
            affiliateStatus: o?.affiliateStatus,
          }))
        : [];

      const slimTickets = Array.isArray(payload.tickets)
        ? payload.tickets.slice(0, 10).map((t: any) => ({
            id: t?.id,
            status: t?.status,
            issueType: t?.issueType,
          }))
        : [];

      const result = await generateChatUiResponse(env, {
        message: payload.message,
        userName: effectiveUserName,
        products: slimProducts,
        orders: slimOrders,
        tickets: slimTickets,
        image: payload.image,
        history: payload.history,
      });
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

  // Lightweight config status (does not validate the key).
  router.get('/status', (_req, res) => {
    res.json({ configured: isGeminiConfigured(env) });
  });

  // Validates whether the configured GEMINI_API_KEY can successfully call Gemini.
  // Protected to avoid turning this into a free public proxy.
  router.post('/check-key', requireAuth(env), requireRoles('admin', 'ops'), async (_req, res, next) => {
    try {
      if (!ensureAiEnabled(res)) return;
      const result = await checkGeminiApiKey(env);
      res.status(result.ok ? 200 : 503).json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

  router.post('/verify-proof', limiterVerifyProof, async (req, res, next) => {
    try {
      if (!ensureAiEnabled(res)) return;
      const payload = proofSchema.parse(req.body);

      // E2E runs should be deterministic and must not depend on external AI quotas.
      if (env.SEED_E2E) {
        res.json({
          orderIdMatch: true,
          amountMatch: true,
          confidenceScore: 95,
          detectedOrderId: payload.expectedOrderId,
          detectedAmount: payload.expectedAmount,
          discrepancyNote: 'E2E mode: AI verification bypassed.',
        });
        return;
      }

      if (!isGeminiConfigured(env)) {
        res.status(503).json({
          error: { code: 'AI_NOT_CONFIGURED', message: 'Gemini is not configured.' },
          requestId: getRequestId(res),
        });
        return;
      }

      if (!enforceDailyLimit(req, res)) return;
      if (!enforceMinInterval(req, res)) return;

      const result = await verifyProofWithAi(env, payload);
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

  router.post('/extract-order', limiterExtractOrder, async (req, res, next) => {
    try {
      if (!ensureAiEnabled(res)) return;
      const payload = extractOrderSchema.parse(req.body);

      // E2E runs should be deterministic and must not depend on external AI quotas.
      if (env.SEED_E2E) {
        res.json({
          orderId: null,
          amount: null,
          confidenceScore: 0,
          notes: 'E2E mode: AI extraction bypassed.',
        });
        return;
      }

      if (!isGeminiConfigured(env)) {
        res.status(503).json({
          error: { code: 'AI_NOT_CONFIGURED', message: 'Gemini is not configured.' },
          requestId: getRequestId(res),
        });
        return;
      }

      if (!enforceDailyLimit(req, res)) return;
      if (!enforceMinInterval(req, res)) return;

      const result = await extractOrderDetailsWithAi(env, { imageBase64: payload.imageBase64 });
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });
  return router;
}
