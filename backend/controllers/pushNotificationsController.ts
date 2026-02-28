import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { getRequester } from '../services/authz.js';
import { prisma } from '../database/prisma.js';
import { getVapidPublicKey } from '../services/pushNotifications.js';
import { writeAuditLog } from '../services/audit.js';
import { logChangeEvent, logAccessEvent, logErrorEvent } from '../config/appLogs.js';

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const subscribeSchema = z.object({
  app: z.enum(['buyer', 'mediator']),
  subscription: subscriptionSchema,
  userAgent: z.string().optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export function makePushNotificationsController(env: Env) {
  return {
    publicKey: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const publicKey = getVapidPublicKey(env);
        if (!publicKey) {
          res.json({ publicKey: null, error: 'Push notifications not configured' });
          return;
        }
        res.json({ publicKey });
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'SYSTEM', severity: 'low', metadata: { handler: 'push/publicKey' } });
        next(err);
      }
    },

    subscribe: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { pgUserId } = getRequester(req);
        if (!pgUserId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const body = subscribeSchema.parse(req.body);
        const db = prisma();

        await db.pushSubscription.upsert({
          where: { endpoint: body.subscription.endpoint },
          create: {
            mongoId: randomUUID(),
            userId: pgUserId,
            app: body.app as any,
            endpoint: body.subscription.endpoint,
            expirationTime: body.subscription.expirationTime ? Math.floor(body.subscription.expirationTime) : undefined,
            keysP256dh: body.subscription.keys.p256dh,
            keysAuth: body.subscription.keys.auth,
            userAgent: body.userAgent,
          },
          update: {
            userId: pgUserId,
            app: body.app as any,
            expirationTime: body.subscription.expirationTime ? Math.floor(body.subscription.expirationTime) : undefined,
            keysP256dh: body.subscription.keys.p256dh,
            keysAuth: body.subscription.keys.auth,
            userAgent: body.userAgent,
          },
        });

        writeAuditLog({
          req,
          action: 'PUSH_SUBSCRIBED',
          entityType: 'PushSubscription',
          entityId: body.subscription.endpoint,
          metadata: { app: body.app },
        });

        logChangeEvent({
          actorUserId: req.auth?.userId,
          actorRoles: req.auth?.roles,
          actorIp: req.ip,
          entityType: 'PushSubscription',
          entityId: body.subscription.endpoint,
          action: 'CREATE',
          requestId: String((res as any).locals?.requestId || ''),
          metadata: { app: body.app },
        });
        logAccessEvent('RESOURCE_ACCESS', { userId: req.auth?.userId, roles: req.auth?.roles, ip: req.ip, resource: 'PushSubscription', requestId: String((res as any).locals?.requestId || ''), metadata: { action: 'PUSH_SUBSCRIBED', app: body.app } });

        res.status(204).send();
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'BUSINESS_LOGIC', severity: 'low', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'push/subscribe' } });
        next(err);
      }
    },

    unsubscribe: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { pgUserId } = getRequester(req);
        if (!pgUserId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const body = unsubscribeSchema.parse(req.body || {});
        const db = prisma();

        await db.pushSubscription.deleteMany({
          where: { endpoint: body.endpoint, userId: pgUserId },
        });

        writeAuditLog({
          req,
          action: 'PUSH_UNSUBSCRIBED',
          entityType: 'PushSubscription',
          entityId: body.endpoint,
          metadata: {},
        });

        logChangeEvent({
          actorUserId: req.auth?.userId,
          actorRoles: req.auth?.roles,
          actorIp: req.ip,
          entityType: 'PushSubscription',
          entityId: body.endpoint,
          action: 'DELETE',
          requestId: String((res as any).locals?.requestId || ''),
        });
        logAccessEvent('RESOURCE_ACCESS', { userId: req.auth?.userId, roles: req.auth?.roles, ip: req.ip, resource: 'PushSubscription', requestId: String((res as any).locals?.requestId || ''), metadata: { action: 'PUSH_UNSUBSCRIBED' } });

        res.status(204).send();
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'BUSINESS_LOGIC', severity: 'low', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'push/unsubscribe' } });
        next(err);
      }
    },
  };
}
