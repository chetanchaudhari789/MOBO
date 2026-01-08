import { Router } from 'express';
import { z } from 'zod';

import type { Env } from '../config/env.js';
import { checkGeminiApiKey, generateChatUiResponse, isGeminiConfigured, verifyProofWithAi } from '../services/aiService.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';

const chatSchema = z.object({
  message: z.string().default(''),
  userId: z.string().optional(),
  userName: z.string().default('Guest'),
  products: z.array(z.any()).optional(),
  orders: z.array(z.any()).optional(),
  tickets: z.array(z.any()).optional(),
  image: z.string().optional(),
});

const proofSchema = z.object({
  imageBase64: z.string().min(1),
  expectedOrderId: z.string().min(1),
  expectedAmount: z.number().finite(),
});

export function aiRoutes(env: Env): Router {
  const router = Router();

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

  router.post('/chat', async (req, res, next) => {
    try {
      const payload = chatSchema.parse(req.body);
      const result = await generateChatUiResponse(env, payload);
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

  router.post('/verify-proof', async (req, res, next) => {
    try {
      const payload = proofSchema.parse(req.body);
      const result = await verifyProofWithAi(env, payload);
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });

  return router;
}
