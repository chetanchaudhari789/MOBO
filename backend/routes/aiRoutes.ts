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

  const maxMessageChars = Math.round(env.AI_MAX_INPUT_CHARS * 1.2);
  const maxHistoryChars = Math.round(env.AI_MAX_INPUT_CHARS * 1.5);

  const chatSchema = z.object({
    message: z.string().max(maxMessageChars).default(''),
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
          content: z.string().max(maxHistoryChars),
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

  // Periodically purge stale entries so the Maps don't grow without bound.
  const PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const purgeStaleEntries = () => {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, value] of dailyUsage) {
      if (value.day !== today) dailyUsage.delete(key);
    }
    for (const [key, ts] of lastCallAt) {
      if (ts < cutoff) lastCallAt.delete(key);
    }
  };
  setInterval(purgeStaleEntries, PURGE_INTERVAL_MS).unref();

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

      let effectiveProducts: any[] = Array.isArray(payload.products) ? payload.products : [];
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
      if (!Array.isArray(effectiveProducts)) {
        effectiveProducts = [];
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

      const rawMessage = String(payload.message || '').trim();
      const normalizedMessage = rawMessage.toLowerCase();
      const hasProducts = Array.isArray(effectiveProducts) && effectiveProducts.length > 0;
      const hasOrders = Array.isArray(payload.orders) && payload.orders.length > 0;
      const hasTickets = Array.isArray(payload.tickets) && payload.tickets.length > 0;
      const normalizeStatus = (value: unknown) => String(value || '').trim();
      const extractCount = () => {
        const topMatch = normalizedMessage.match(/top\s+(\d{1,2})/i);
        if (topMatch?.[1]) return Math.max(1, Math.min(50, Number(topMatch[1])));
        const countMatch = normalizedMessage.match(/(\d{1,2})\s+(?:deals|loot)/i);
        if (countMatch?.[1]) return Math.max(1, Math.min(50, Number(countMatch[1])));
        return null;
      };

      if (hasProducts) {
        const count = extractCount();
        const wantsAll = normalizedMessage.includes('all deals') || normalizedMessage.includes('all available deals');
        const wantsLoot = normalizedMessage.includes('loot deals') || normalizedMessage.includes('deals');
        const wantsLowest = normalizedMessage.includes('lowest') || normalizedMessage.includes('cheapest');
        const wantsSpecific =
          normalizedMessage.includes('show') ||
          normalizedMessage.includes('find') ||
          normalizedMessage.includes('show me');

        if (wantsAll) {
          res.json({
            text: 'Here are all available deals right now.',
            intent: 'search_deals',
            uiType: 'product_card',
            data: effectiveProducts.slice(0, 50),
          });
          return;
        }

        if (wantsSpecific && rawMessage.length > 6) {
          const tokens = normalizedMessage
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 3);

          let best: any = null;
          let bestScore = 0;
          for (const product of effectiveProducts) {
            const title = String(product?.title || '').toLowerCase();
            if (!title) continue;
            let score = 0;
            for (const t of tokens) {
              if (title.includes(t)) score += 1;
            }
            if (tokens.length && title.includes(tokens.join(' '))) score += 3;
            if (score > bestScore) {
              bestScore = score;
              best = product;
            }
          }

          if (best && bestScore >= 2) {
            res.json({
              text: 'Here is the deal you asked for.',
              intent: 'search_deals',
              uiType: 'product_card',
              data: [best],
            });
            return;
          }
        }

        if (wantsLowest) {
          const sorted = [...effectiveProducts].sort((a: any, b: any) => {
            const aPrice = Number(a?.price ?? a?.originalPrice ?? 0);
            const bPrice = Number(b?.price ?? b?.originalPrice ?? 0);
            return aPrice - bPrice;
          });
          const take = count ?? 1;
          res.json({
            text: take === 1 ? 'Here is the lowest priced deal.' : `Here are the lowest ${take} deals.`,
            intent: 'search_deals',
            uiType: 'product_card',
            data: sorted.slice(0, take),
          });
          return;
        }

        if (wantsLoot) {
          const take = count ?? 5;
          res.json({
            text: `Here are the top ${take} loot deals for you.`,
            intent: 'search_deals',
            uiType: 'product_card',
            data: effectiveProducts.slice(0, take),
          });
          return;
        }
      } else if (normalizedMessage.includes('deal') || normalizedMessage.includes('loot')) {
        res.json({
          text: 'I could not find any active deals for your mediator right now.',
          intent: 'search_deals',
        });
        return;
      }

      const wantsSystem =
        normalizedMessage.includes('what is') ||
        normalizedMessage.includes('explain') ||
        normalizedMessage.includes('how it works') ||
        normalizedMessage.includes('system');

      if (wantsSystem) {
        res.json({
          text:
            'BUZZMA connects buyers to mediator‑published deals. You can explore deals, place orders, submit proofs, and track cashback. Ask me about **deals**, **orders**, or **tickets** anytime.',
          intent: 'unknown',
        });
        return;
      }

      if (normalizedMessage.includes('order') || normalizedMessage.includes('cashback')) {
        if (hasOrders) {
          const latest = (payload.orders ?? [])[0] as any;
          const status = normalizeStatus(latest?.status) || 'Pending';
          const payment = normalizeStatus(latest?.paymentStatus) || 'Pending';
          const affiliate = normalizeStatus(latest?.affiliateStatus) || 'Unchecked';
          res.json({
            text: `Your latest order is **${status}**. Payment: **${payment}**, Affiliate: **${affiliate}**.`,
            intent: 'check_order_status',
          });
          return;
        }
        res.json({
          text: 'I could not find any orders yet. Want to explore deals?',
          intent: 'check_order_status',
        });
        return;
      }

      if (normalizedMessage.includes('ticket') || normalizedMessage.includes('support')) {
        if (hasTickets) {
          const latest = (payload.tickets ?? [])[0] as any;
          const status = normalizeStatus(latest?.status) || 'Open';
          const issue = normalizeStatus(latest?.issueType) || 'Support';
          res.json({
            text: `Your latest ticket (**${issue}**) is **${status}**.`,
            intent: 'check_ticket_status',
          });
          return;
        }
        res.json({
          text: 'No tickets found. You can create one from the Tickets tab.',
          intent: 'check_ticket_status',
        });
        return;
      }

      if (normalizedMessage.includes('profile') || normalizedMessage.includes('wallet')) {
        res.json({
          text: 'Opening your **Profile & Wallet**.',
          intent: 'navigation',
          navigateTo: 'profile',
        });
        return;
      }

      if (normalizedMessage.includes('explore') || normalizedMessage.includes('home')) {
        res.json({
          text: 'Taking you to **Explore Deals**.',
          intent: 'navigation',
          navigateTo: normalizedMessage.includes('home') ? 'home' : 'explore',
        });
        return;
      }

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

  router.post('/verify-proof', requireAuth(env), limiterVerifyProof, async (req, res, next) => {
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

  router.post('/extract-order', requireAuth(env), limiterExtractOrder, async (req, res, next) => {
    try {
      if (!ensureAiEnabled(res)) return;
      const payload = extractOrderSchema.parse(req.body);

      if (!enforceDailyLimit(req, res)) return;
      if (!enforceMinInterval(req, res)) return;

      // extractOrderDetailsWithAi now works without Gemini via Tesseract.js
      // fallback, so we no longer need to bypass in E2E or non-Gemini mode.
      const result = await extractOrderDetailsWithAi(env, { imageBase64: payload.imageBase64 });
      res.json(result);
    } catch (err) {
      if (!sendKnownError(err, res)) next(err);
    }
  });
  return router;
}
