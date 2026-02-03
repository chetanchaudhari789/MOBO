import webpush from 'web-push';
import type { Env } from '../config/env.js';
import type { OrderWorkflowStatus } from '../models/Order.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { UserModel } from '../models/User.js';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

type VapidKeys = { publicKey: string; privateKey: string; subject: string };

let cachedKeys: VapidKeys | null = null;
let configured = false;

function ensureWebPush(env: Env): VapidKeys {
  if (cachedKeys) return cachedKeys;

  const subject = String(env.VAPID_SUBJECT || 'mailto:admin@example.com');
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();

  if (publicKey && privateKey) {
    cachedKeys = { publicKey, privateKey, subject };
  } else if (env.NODE_ENV !== 'production') {
    const generated = webpush.generateVAPIDKeys();
    cachedKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
  } else {
    throw new Error('VAPID keys are required in production');
  }

  return cachedKeys;
}

function configureWebPush(env: Env) {
  if (configured) return;
  const keys = ensureWebPush(env);
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  configured = true;
}

export function getVapidPublicKey(env: Env): string {
  const keys = ensureWebPush(env);
  return keys.publicKey;
}

async function removeInvalidSubscription(endpoint: string) {
  try {
    await PushSubscriptionModel.deleteOne({ endpoint });
  } catch {
    // ignore cleanup errors
  }
}

export async function sendPushToUser(params: {
  env: Env;
  userId: string;
  app: 'buyer' | 'mediator';
  payload: PushPayload;
}) {
  if (!params.userId) return;

  configureWebPush(params.env);

  const subscriptions = await PushSubscriptionModel.find({
    userId: params.userId,
    app: params.app,
  })
    .select({ endpoint: 1, keys: 1, expirationTime: 1 })
    .lean();

  if (!subscriptions.length) return;

  const payload = JSON.stringify(params.payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String((sub as any).endpoint || ''),
            keys: {
              p256dh: String((sub as any).keys?.p256dh || ''),
              auth: String((sub as any).keys?.auth || ''),
            },
            expirationTime: (sub as any).expirationTime,
          },
          payload
        );
      } catch (err: any) {
        const status = Number(err?.statusCode || err?.status || 0);
        if (status === 404 || status === 410) {
          await removeInvalidSubscription(String((sub as any).endpoint || ''));
        }
      }
    })
  );
}

function shortOrderId(orderId: any): string {
  const s = String(orderId || '');
  return s.length > 6 ? s.slice(-6) : s;
}

function buyerPayloadForWorkflow(to: OrderWorkflowStatus, orderId: any): PushPayload | null {
  const shortId = shortOrderId(orderId);
  switch (to) {
    case 'UNDER_REVIEW':
      return {
        title: 'Verification in progress',
        body: `Your order #${shortId} is under review.`,
        url: '/',
      };
    case 'APPROVED':
      return {
        title: 'Order approved',
        body: `Order #${shortId} has been approved.`,
        url: '/',
      };
    case 'REWARD_PENDING':
      return {
        title: 'Cashback pending',
        body: `Cashback for order #${shortId} is pending.`,
        url: '/',
      };
    case 'COMPLETED':
      return {
        title: 'Cashback sent',
        body: `Cashback for order #${shortId} has been processed.`,
        url: '/',
      };
    case 'REJECTED':
    case 'FAILED':
      return {
        title: 'Order needs attention',
        body: `There is an issue with order #${shortId}.`,
        url: '/',
      };
    default:
      return null;
  }
}

export async function notifyOrderWorkflowPush(params: {
  env: Env;
  order: any;
  from: OrderWorkflowStatus;
  to: OrderWorkflowStatus;
}) {
  try {
    const buyerId = String(params.order?.userId || '');
    const buyerPayload = buyerPayloadForWorkflow(params.to, params.order?._id);
    if (buyerId && buyerPayload) {
      await sendPushToUser({ env: params.env, userId: buyerId, app: 'buyer', payload: buyerPayload });
    }

    if (params.to === 'UNDER_REVIEW') {
      const mediatorCode = String(params.order?.managerName || '').trim();
      if (mediatorCode) {
        const mediators = await UserModel.find({ mediatorCode, roles: 'mediator', deletedAt: null })
          .select({ _id: 1 })
          .lean();
        const payload: PushPayload = {
          title: 'New order to review',
          body: `Order #${shortOrderId(params.order?._id)} is ready for verification.`,
          url: '/',
        };
        await Promise.all(
          mediators.map((m) =>
            sendPushToUser({ env: params.env, userId: String((m as any)._id || ''), app: 'mediator', payload })
          )
        );
      }
    }
  } catch {
    // Avoid breaking core workflows if push delivery fails.
  }
}
