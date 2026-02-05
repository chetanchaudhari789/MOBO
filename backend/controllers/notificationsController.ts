import type { NextFunction, Request, Response } from 'express';
import { UserModel } from '../models/User.js';
import { OrderModel } from '../models/Order.js';
import { PayoutModel } from '../models/Payout.js';
import { AppError } from '../middleware/errors.js';
import { paiseToRupees } from '../utils/money.js';
import { getRequester } from '../services/authz.js';

type UiNotification = {
  id: string;
  type: 'success' | 'info' | 'alert';
  title: string;
  message: string;
  createdAt: string;
  action?: { label: string; href?: string };
};

function safeOrderShortId(order: any): string {
  const external = String(order?.externalOrderId || '').trim();
  if (external) return external.length > 20 ? external.slice(-20) : external;
  const s = String(order?._id || order || '').trim();
  return s.length > 6 ? s.slice(-6) : s || 'Pending';
}

function nowIso() {
  return new Date().toISOString();
}

export function makeNotificationsController() {
  return {
    list: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId, roles, user } = getRequester(req);
        if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const isShopper = roles.includes('shopper');
        const isMediator = roles.includes('mediator');
        const notifications: UiNotification[] = [];

        if (isShopper) {
          const orders = await OrderModel.find({ userId, deletedAt: null })
            .select({
              _id: 1,
              items: 1,
              workflowStatus: 1,
              paymentStatus: 1,
              affiliateStatus: 1,
              screenshots: 1,
              reviewLink: 1,
              verification: 1,
              rejection: 1,
              missingProofRequests: 1,
              createdAt: 1,
              updatedAt: 1,
            })
            .sort({ updatedAt: -1 })
            .limit(100)
            .lean();

          for (const o of orders) {
            const shortId = safeOrderShortId(o);
            const wf = String((o as any).workflowStatus || '').trim();
            const pay = String((o as any).paymentStatus || '').trim();
            const aff = String((o as any).affiliateStatus || '').trim();
            const hasPurchaseProof = !!(o as any)?.screenshots?.order;
            const ts = (o as any).updatedAt ? new Date((o as any).updatedAt).toISOString() : nowIso();

            const dealTypes = Array.isArray((o as any).items)
              ? (o as any).items.map((it: any) => String(it?.dealType || '')).filter(Boolean)
              : [];
            const requiresReview = dealTypes.includes('Review');
            const requiresRating = dealTypes.includes('Rating');
            const hasReviewProof = !!((o as any).reviewLink || (o as any)?.screenshots?.review);
            const hasRatingProof = !!(o as any)?.screenshots?.rating;
            const orderVerifiedAt = (o as any)?.verification?.order?.verifiedAt
              ? new Date((o as any).verification.order.verifiedAt)
              : null;
            const rejection = (o as any)?.rejection;
            const missingSteps: string[] = [];
            if (requiresReview && !hasReviewProof) missingSteps.push('review');
            if (requiresRating && !hasRatingProof) missingSteps.push('rating');

            const requestedMissing = Array.isArray((o as any).missingProofRequests)
              ? (o as any).missingProofRequests
                  .map((r: any) => String(r?.type || '').trim())
                  .filter((t: string) => (t === 'review' || t === 'rating') && missingSteps.includes(t))
              : [];

            if (!hasPurchaseProof && (wf === 'ORDERED' || wf === 'REDIRECTED' || wf === 'CREATED')) {
              notifications.push({
                id: `order:${String(o._id)}:need-proof`,
                type: 'alert',
                title: 'Upload purchase proof',
                message: `Upload your purchase screenshot for order #${shortId} to start verification.`,
                createdAt: ts,
              });
              continue;
            }

            if (rejection?.reason) {
              notifications.push({
                id: `order:${String(o._id)}:rejected:${ts}`,
                type: 'alert',
                title: 'Proof rejected',
                message: rejection.reason || `Your proof for order #${shortId} was rejected.`,
                createdAt: ts,
                action: { label: 'Fix now', href: '/orders' },
              });
              continue;
            }

            if (requestedMissing.length > 0) {
              const label = requestedMissing.length === 2 ? 'review & rating' : requestedMissing[0];
              notifications.push({
                id: `order:${String(o._id)}:requested:${requestedMissing.slice().sort().join(',')}:${ts}`,
                type: 'alert',
                title: 'Action requested by mediator',
                message: `Please submit your ${label} proof for order #${shortId}.`,
                createdAt: ts,
                action: { label: 'Upload now', href: '/orders' },
              });
              continue;
            }

            // Purchase is verified but additional steps are missing (review/rating).
            if (orderVerifiedAt && missingSteps.length > 0) {
              const label = missingSteps.length === 2 ? 'review & rating' : missingSteps[0];
              notifications.push({
                id: `order:${String(o._id)}:missing:${missingSteps.slice().sort().join(',')}:${ts}`,
                type: 'alert',
                title: 'Action required to unlock cashback',
                message: `Please submit your ${label} proof for order #${shortId}.`,
                createdAt: ts,
              });
              continue;
            }

            if (wf === 'UNDER_REVIEW' || wf === 'PROOF_SUBMITTED') {
              notifications.push({
                id: `order:${String(o._id)}:under-review:${ts}`,
                type: 'info',
                title: 'Verification in progress',
                message: `Your order #${shortId} is under review.`,
                createdAt: ts,
              });
              continue;
            }

            if (pay === 'Paid' || wf === 'COMPLETED' || aff === 'Approved_Settled') {
              notifications.push({
                id: `order:${String(o._id)}:paid:${ts}`,
                type: 'success',
                title: 'Cashback sent',
                message: `Cashback for order #${shortId} has been processed.`,
                createdAt: ts,
              });
              continue;
            }

            if (wf === 'REJECTED' || wf === 'FAILED' || aff === 'Rejected' || aff === 'Fraud_Alert' || aff === 'Frozen_Disputed' || aff === 'Cap_Exceeded') {
              notifications.push({
                id: `order:${String(o._id)}:issue:${ts}`,
                type: 'alert',
                title: 'Order needs attention',
                message: `There is an issue with order #${shortId} (${wf || aff || pay}).`,
                createdAt: ts,
              });
            }
          }

          // Also show onboarding status if applicable.
          if (user && (user as any).isVerifiedByMediator === false) {
            notifications.unshift({
              id: `shopper:${userId}:pending-approval`,
              type: 'info',
              title: 'Approval pending',
              message: 'Your mediator approval is pending. You will be notified once approved.',
              createdAt: nowIso(),
            });
          }
        }

        if (isMediator) {
          const mediatorCode = String((user as any)?.mediatorCode || '').trim();
          if (mediatorCode) {
            const [pendingUsers, pendingOrders] = await Promise.all([
              UserModel.countDocuments({ parentCode: mediatorCode, roles: 'shopper', isVerifiedByMediator: false, deletedAt: null }),
              OrderModel.countDocuments({ managerName: mediatorCode, workflowStatus: 'UNDER_REVIEW', deletedAt: null }),
            ]);

            if (pendingUsers > 0) {
              notifications.push({
                id: `mediator:${mediatorCode}:pending-users:${pendingUsers}`,
                type: 'alert',
                title: 'Buyer approvals pending',
                message: `${pendingUsers} buyers are waiting for approval.`,
                createdAt: nowIso(),
              });
            }

            if (pendingOrders > 0) {
              notifications.push({
                id: `mediator:${mediatorCode}:pending-orders:${pendingOrders}`,
                type: 'alert',
                title: 'Order verification pending',
                message: `${pendingOrders} orders need verification.`,
                createdAt: nowIso(),
              });
            }
          }

          // Recent payouts recorded to this mediator.
          const payouts = await PayoutModel.find({ beneficiaryUserId: userId as any, deletedAt: null })
            .select({ _id: 1, amountPaise: 1, status: 1, processedAt: 1, createdAt: 1 })
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

          for (const p of payouts) {
            const createdAt = (p as any).processedAt
              ? new Date((p as any).processedAt).toISOString()
              : new Date((p as any).createdAt ?? Date.now()).toISOString();
            const amount = paiseToRupees(Number((p as any).amountPaise ?? 0));
            notifications.push({
              id: `payout:${String((p as any)._id)}`,
              type: (p as any).status === 'paid' ? 'success' : 'info',
              title: 'Payout recorded',
              message: `₹${amount} payout has been recorded (${String((p as any).status || 'requested')}).`,
              createdAt,
            });
          }
        }

        // Sort newest-first and cap.
        notifications.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        res.json(notifications.slice(0, 50));
      } catch (err) {
        next(err);
      }
    },
  };
}
