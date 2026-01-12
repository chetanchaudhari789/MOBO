import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';

import type { Env } from '../config/env.js';
<<<<<<< HEAD
import {
  checkGeminiApiKey,
  extractOrderDetailsWithAi,
  generateChatUiResponse,
  isGeminiConfigured,
  verifyProofWithAi,
} from '../services/aiService.js';
=======
import { checkGeminiApiKey, generateChatUiResponse, isGeminiConfigured, verifyProofWithAi } from '../services/aiService.js';
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
import { optionalAuth, requireAuth, requireRoles } from '../middleware/auth.js';

const chatSchema = z.object({
  message: z.string().max(4000).default(''),
  // Legacy UI fields (ignored server-side unless no auth is present)
  userId: z.string().optional(),
  userName: z.string().max(120).default('Guest'),
  products: z.array(z.any()).max(200).optional(),
  orders: z.array(z.any()).max(200).optional(),
  tickets: z.array(z.any()).max(200).optional(),
  // data URL / base64; overall request size is also capped by express.json({limit:'10mb'})
  image: z.string().max(8_000_000).optional(),
});

const proofSchema = z.object({
  imageBase64: z.string().min(1).max(8_000_000),
  expectedOrderId: z.string().min(1),
  expectedAmount: z.number().finite(),
});

<<<<<<< HEAD
const extractOrderSchema = z.object({
  imageBase64: z.string().min(1).max(8_000_000),
});

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
export function aiRoutes(env: Env): Router {
  const router = Router();

  // Optional auth so the UI can call AI routes without sending a token,
  // but if a token is provided we can trust user identity from DB.
  router.use(optionalAuth(env));

  // Tighten AI abuse surface beyond the global app limiter.
  // - Authenticated users get a higher quota.
  // - Unauthenticated requests are heavily throttled.
  const limiterChat = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      if (env.NODE_ENV !== 'production') return 10_000;
      return req.auth?.userId ? 120 : 20;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
  });

  const limiterVerifyProof = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      if (env.NODE_ENV !== 'production') return 10_000;
      return req.auth?.userId ? 60 : 10;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
  });

<<<<<<< HEAD
  const limiterExtractOrder = rateLimit({
    windowMs: 60_000,
    limit: (req) => {
      if (env.NODE_ENV !== 'production') return 10_000;
      return req.auth?.userId ? 60 : 10;
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.auth?.userId || req.ip || 'unknown'),
  });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  const sendKnownError = (err: unknown, res: any): boolean => {
    if (err instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: { code: 'BAD_REQUEST', message: 'Invalid request', details: err.issues } });
      return true;
    }
    const anyErr = err as any;
    if (anyErr && typeof anyErr.statusCode === 'number') {
      res
        .status(anyErr.statusCode)
        .json({
          error: {
            code: 'AI_NOT_CONFIGURED',
            message: String(anyErr.message || 'AI not configured'),
          },
        });
      return true;
    }
    return false;
  };

  router.post('/chat', limiterChat, async (req, res, next) => {
    try {
      const payload = chatSchema.parse(req.body);

      // Zero-trust identity: never trust userId/userName from the client if auth is present.
      const authUser = req.auth?.user;
      const effectiveUserName = authUser ? String((authUser as any)?.name || 'User') : payload.userName;

      const result = await generateChatUiResponse(env, {
        message: payload.message,
        userName: effectiveUserName,
        products: payload.products,
        orders: payload.orders,
        tickets: payload.tickets,
        image: payload.image,
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
      const result = await checkGeminiApiKey(env);
      res.status(result.ok ? 200 : 503).json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

  router.post('/verify-proof', limiterVerifyProof, async (req, res, next) => {
    try {
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

      const result = await verifyProofWithAi(env, payload);
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

<<<<<<< HEAD
  router.post('/extract-order', limiterExtractOrder, async (req, res, next) => {
    try {
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

      const result = await extractOrderDetailsWithAi(env, { imageBase64: payload.imageBase64 });
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
  return router;
}
