import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';
import { getRequester } from '../services/authz.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { getVapidPublicKey } from '../services/pushNotifications.js';
import { writeAuditLog } from '../services/audit.js';

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
        next(err);
      }
    },

    subscribe: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getRequester(req);
        if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const body = subscribeSchema.parse(req.body);

        await PushSubscriptionModel.findOneAndUpdate(
          { endpoint: body.subscription.endpoint },
          {
            $set: {
              userId,
              app: body.app,
              endpoint: body.subscription.endpoint,
              expirationTime: body.subscription.expirationTime ?? undefined,
              keys: {
                p256dh: body.subscription.keys.p256dh,
                auth: body.subscription.keys.auth,
              },
              userAgent: body.userAgent,
            },
          },
          { upsert: true, new: true }
        );

        writeAuditLog({
          req,
          action: 'PUSH_SUBSCRIBED',
          entityType: 'PushSubscription',
          entityId: body.subscription.endpoint,
          metadata: { app: body.app },
        });

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },

    unsubscribe: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = getRequester(req);
        if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const body = unsubscribeSchema.parse(req.body || {});

        await PushSubscriptionModel.deleteOne({ endpoint: body.endpoint, userId });

        writeAuditLog({
          req,
          action: 'PUSH_UNSUBSCRIBED',
          entityType: 'PushSubscription',
          entityId: body.endpoint,
          metadata: {},
        });

        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  };
}
