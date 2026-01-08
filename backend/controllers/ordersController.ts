import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import type { OrderWorkflowStatus } from '../models/Order.js';
import { createOrderSchema, submitClaimSchema } from '../validations/orders.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiOrder } from '../utils/uiMappers.js';
import { pushOrderEvent, isTerminalAffiliateStatus } from '../services/orderEvents.js';
import { transitionOrderWorkflow } from '../services/orderWorkflow.js';

export function makeOrdersController() {
  return {
    getUserOrders: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = String(req.params.userId || '');
        if (!userId) throw new AppError(400, 'INVALID_USER_ID', 'Invalid userId');

        const requesterId = req.auth?.userId;
        const requesterRoles = req.auth?.roles ?? [];
        const privileged = requesterRoles.includes('admin') || requesterRoles.includes('ops');
        if (!privileged && requesterId !== userId) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot access other user orders');
        }

        const orders = await OrderModel.find({
          userId,
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .limit(2000)
          .lean();

        res.json(orders.map(toUiOrder));
      } catch (err) {
        next(err);
      }
    },

    createOrder: async (req: Request, res: Response, next: NextFunction) => {
      const session = await mongoose.startSession();
      try {
        const body = createOrderSchema.parse(req.body);

        const requesterId = req.auth?.userId;
        const requesterRoles = req.auth?.roles ?? [];
        if (!requesterId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
        if (!requesterRoles.includes('shopper')) {
          throw new AppError(403, 'FORBIDDEN', 'Only buyers can create orders');
        }

        if (String(body.userId) !== String(requesterId)) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot create orders for another user');
        }

        const user = await UserModel.findById(body.userId).lean();
        if (!user || user.deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        // Abuse prevention: basic velocity limits (per buyer).
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const [hourly, daily] = await Promise.all([
          OrderModel.countDocuments({ userId: user._id, createdAt: { $gte: oneHourAgo }, deletedAt: null }),
          OrderModel.countDocuments({ userId: user._id, createdAt: { $gte: oneDayAgo }, deletedAt: null }),
        ]);
        if (hourly >= 10 || daily >= 30) {
          throw new AppError(429, 'VELOCITY_LIMIT', 'Too many orders created. Please try later.');
        }

        if (body.externalOrderId) {
          const dup = await OrderModel.exists({ externalOrderId: body.externalOrderId, deletedAt: null });
          if (dup) {
            throw new AppError(
              409,
              'DUPLICATE_EXTERNAL_ORDER_ID',
              'This Order ID has already been submitted in our system.'
            );
          }
        }

        // CRITICAL ANTI-FRAUD: Prevent duplicate orders for the same deal by the same buyer
        const firstItem = body.items[0];
        const existingDealOrder = await OrderModel.findOne({
          userId: user._id,
          'items.0.productId': firstItem.productId,
          deletedAt: null,
          workflowStatus: { $nin: ['FAILED', 'REJECTED'] },
        });
        if (existingDealOrder) {
          throw new AppError(
            409,
            'DUPLICATE_DEAL_ORDER',
            'You already have an active order for this deal.'
          );
        }

        const upstreamMediatorCode = String(user.parentCode || '').trim();
        if (!upstreamMediatorCode) {
          throw new AppError(409, 'MISSING_MEDIATOR_LINK', 'Your account is not linked to a mediator');
        }

        const item = body.items[0];
        const campaign = await CampaignModel.findOne({
          _id: item.campaignId,
          deletedAt: null,
        }).session(session);
        if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        if (String((campaign as any).status || '').toLowerCase() !== 'active') {
          throw new AppError(409, 'CAMPAIGN_NOT_ACTIVE', 'Campaign is not active');
        }

        // Non-negotiable isolation: buyer can only place orders for campaigns accessible to their lineage.
        // Access is granted if either:
        // - campaign is assigned to the buyer's agency (allowedAgencyCodes), OR
        // - campaign has an explicit slot assignment for the buyer's mediator (assignments).
        const mediatorUser = await UserModel.findOne({ roles: 'mediator', mediatorCode: upstreamMediatorCode, deletedAt: null })
          .select({ parentCode: 1 })
          .lean();
        const upstreamAgencyCode = String((mediatorUser as any)?.parentCode || '').trim();

        const allowedAgencyCodes = Array.isArray((campaign as any).allowedAgencyCodes)
          ? ((campaign as any).allowedAgencyCodes as string[]).map((c) => String(c))
          : [];

        const assignmentsObj = campaign.assignments instanceof Map
          ? campaign.assignments
          : new Map(Object.entries((campaign as any).assignments ?? {}));
        const hasMediatorAssignment = upstreamMediatorCode ? assignmentsObj.has(upstreamMediatorCode) : false;
        const hasAgencyAccess = upstreamAgencyCode ? allowedAgencyCodes.includes(upstreamAgencyCode) : false;

        if (!hasAgencyAccess && !hasMediatorAssignment) {
          throw new AppError(403, 'FORBIDDEN', 'Campaign is not available for your network');
        }

        // Slot checks (global + per-mediator assignment)
        if ((campaign.usedSlots ?? 0) >= (campaign.totalSlots ?? 0)) {
          throw new AppError(409, 'SOLD_OUT', 'Sold Out Globally');
        }

        // (Reuse assignmentsObj for slot math below)
        const assignmentRaw = upstreamMediatorCode ? assignmentsObj.get(upstreamMediatorCode) : undefined;
        const assigned = upstreamMediatorCode
          ? typeof assignmentRaw === 'number'
            ? assignmentRaw
            : Number((assignmentRaw as any)?.limit ?? 0)
          : 0;
        if (upstreamMediatorCode && assigned > 0) {
          const mediatorSales = await OrderModel.countDocuments({
            managerName: upstreamMediatorCode,
            'items.0.campaignId': campaign._id,
            status: { $ne: 'Cancelled' },
            deletedAt: null,
          });
          if (mediatorSales >= assigned) {
            throw new AppError(
              409,
              'SOLD_OUT_FOR_PARTNER',
              `Sold out for your partner (${upstreamMediatorCode}).`
            );
          }
        }

        // Commission snapshot: prefer published Deal record if productId is a Deal id.
        let commissionPaise = rupeesToPaise(item.commission);
        const maybeDeal = await DealModel.findById(item.productId).lean();
        if (maybeDeal && !maybeDeal.deletedAt) {
          commissionPaise = maybeDeal.commissionPaise;
        }

        const created = await session.withTransaction(async () => {
          // If this is an upgrade from a redirect-tracked pre-order, update that order instead of creating a new one.
          if (body.preOrderId) {
            const existing = await OrderModel.findOne({
              _id: body.preOrderId,
              userId: user._id,
              deletedAt: null,
            }).session(session);
            if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pre-order not found');
            if ((existing as any).frozen) throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
            if (String((existing as any).workflowStatus) !== 'REDIRECTED') {
              throw new AppError(409, 'ORDER_STATE_MISMATCH', 'Pre-order is not in REDIRECTED state');
            }

            // Slot consumption happens on ORDERED.
            campaign.usedSlots = (campaign.usedSlots ?? 0) + 1;
            await campaign.save({ session });

            (existing as any).brandUserId = campaign.brandUserId;
            (existing as any).items = body.items.map((it) => ({
              productId: it.productId,
              title: it.title,
              image: it.image,
              priceAtPurchasePaise: rupeesToPaise(it.priceAtPurchase),
              commissionPaise,
              campaignId: it.campaignId,
              dealType: it.dealType,
              quantity: it.quantity,
              platform: it.platform,
              brandName: it.brandName,
            }));
            (existing as any).totalPaise = body.items.reduce(
              (acc, it) => acc + rupeesToPaise(it.priceAtPurchase) * it.quantity,
              0
            );
            (existing as any).status = 'Ordered';
            (existing as any).paymentStatus = 'Pending';
            (existing as any).affiliateStatus = 'Unchecked';
            (existing as any).managerName = upstreamMediatorCode;
            (existing as any).agencyName = 'Partner Agency';
            (existing as any).buyerName = user.name;
            (existing as any).buyerMobile = user.mobile;
            (existing as any).brandName = item.brandName ?? campaign.brandName;
            (existing as any).externalOrderId = body.externalOrderId;
            (existing as any).screenshots = body.screenshots ?? {};
            (existing as any).reviewLink = body.reviewLink;
            (existing as any).events = pushOrderEvent((existing as any).events as any, {
              type: 'ORDERED',
              at: new Date(),
              actorUserId: user._id,
              metadata: { campaignId: String(campaign._id), mediatorCode: upstreamMediatorCode },
            }) as any;
            (existing as any).updatedBy = user._id;
            await (existing as any).save({ session });

            // State machine: REDIRECTED -> ORDERED
            const updated = await transitionOrderWorkflow({
              orderId: String((existing as any)._id),
              from: 'REDIRECTED',
              to: 'ORDERED',
              actorUserId: String(user._id),
              metadata: { source: 'createOrder(preOrderId)' },
              session,
            });
            return updated;
          }

          campaign.usedSlots = (campaign.usedSlots ?? 0) + 1;
          await campaign.save({ session });

          const order = await OrderModel.create(
            [
              {
                userId: user._id,
                brandUserId: campaign.brandUserId,
                items: body.items.map((it) => ({
                  productId: it.productId,
                  title: it.title,
                  image: it.image,
                  priceAtPurchasePaise: rupeesToPaise(it.priceAtPurchase),
                  commissionPaise,
                  campaignId: it.campaignId,
                  dealType: it.dealType,
                  quantity: it.quantity,
                  platform: it.platform,
                  brandName: it.brandName,
                })),
                totalPaise: body.items.reduce(
                  (acc, it) => acc + rupeesToPaise(it.priceAtPurchase) * it.quantity,
                  0
                ),
                workflowStatus: 'ORDERED',
                status: 'Ordered',
                paymentStatus: 'Pending',
                affiliateStatus: 'Unchecked',
                managerName: upstreamMediatorCode,
                agencyName: 'Partner Agency',
                buyerName: user.name,
                buyerMobile: user.mobile,
                brandName: item.brandName ?? campaign.brandName,
                externalOrderId: body.externalOrderId,
                screenshots: body.screenshots ?? {},
                reviewLink: body.reviewLink,
                events: pushOrderEvent([], {
                  type: 'ORDERED',
                  at: new Date(),
                  actorUserId: user._id,
                  metadata: { campaignId: String(campaign._id), mediatorCode: upstreamMediatorCode },
                }),
                createdBy: user._id,
              },
            ],
            { session }
          );

          return order[0];
        });

        // UI often submits the initial order screenshot at creation time.
        // If proof is already present, progress the strict workflow so Ops can verify.
        let finalOrder: any = created;
        const initialProofTypes: Array<'order' | 'rating' | 'review'> = [];
        if (body.screenshots?.order) initialProofTypes.push('order');
        if (body.screenshots?.rating) initialProofTypes.push('rating');
        if (body.reviewLink) initialProofTypes.push('review');

        if (initialProofTypes.length) {
          // Attach an auditable proof-submitted event.
          (finalOrder as any).events = pushOrderEvent((finalOrder as any).events as any, {
            type: 'PROOF_SUBMITTED',
            at: new Date(),
            actorUserId: requesterId,
            metadata: { type: initialProofTypes[0] },
          }) as any;
          await (finalOrder as any).save();

          const afterProof = await transitionOrderWorkflow({
            orderId: String((finalOrder as any)._id),
            from: ((finalOrder as any).workflowStatus ?? 'ORDERED') as OrderWorkflowStatus,
            to: 'PROOF_SUBMITTED',
            actorUserId: String(requesterId || ''),
            metadata: { proofType: initialProofTypes[0], source: 'createOrder' },
          });

          finalOrder = await transitionOrderWorkflow({
            orderId: String((afterProof as any)._id),
            from: 'PROOF_SUBMITTED',
            to: 'UNDER_REVIEW',
            actorUserId: undefined,
            metadata: { system: true, source: 'createOrder' },
          });
        }

        res
          .status(201)
          .json(toUiOrder(finalOrder.toObject ? finalOrder.toObject() : (finalOrder as any)));
      } catch (err) {
        next(err);
      } finally {
        session.endSession();
      }
    },

    submitClaim: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = submitClaimSchema.parse(req.body);
        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if ((order as any).frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        const requesterId = req.auth?.userId;
        const requesterRoles = req.auth?.roles ?? [];
        const privileged = requesterRoles.includes('admin') || requesterRoles.includes('ops');
        if (!privileged && String(order.userId) !== String(requesterId)) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot modify other user orders');
        }

        if (isTerminalAffiliateStatus(String(order.affiliateStatus))) {
          throw new AppError(409, 'ORDER_FINALIZED', 'This order is finalized and cannot be modified');
        }

        const wf = String((order as any).workflowStatus || 'CREATED');
        if (wf !== 'ORDERED' && wf !== 'UNDER_REVIEW') {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot submit proof in state ${wf}`);
        }

        if (body.type === 'review') {
          order.reviewLink = body.data;
        } else if (body.type === 'rating') {
          order.screenshots = { ...(order.screenshots ?? {}), rating: body.data } as any;
        } else if (body.type === 'order') {
          order.screenshots = { ...(order.screenshots ?? {}), order: body.data } as any;
        }

        if (order.affiliateStatus === 'Rejected' || order.affiliateStatus === 'Fraud_Alert') {
          order.affiliateStatus = 'Unchecked';
        }

        order.events = pushOrderEvent(order.events as any, {
          type: 'PROOF_SUBMITTED',
          at: new Date(),
          actorUserId: requesterId,
          metadata: { type: body.type },
        }) as any;

        await order.save();

        // Strict state machine progression for first proof submission:
        // ORDERED -> PROOF_SUBMITTED -> UNDER_REVIEW
        // If already UNDER_REVIEW, we just persist the new proof without rewinding workflow.
        if (wf === 'UNDER_REVIEW') {
          res.json(toUiOrder(order.toObject()));
          return;
        }

        const afterProof = await transitionOrderWorkflow({
          orderId: String(order._id),
          from: (order as any).workflowStatus,
          to: 'PROOF_SUBMITTED',
          actorUserId: String(requesterId || ''),
          metadata: { proofType: body.type },
        });

        const afterReview = await transitionOrderWorkflow({
          orderId: String(afterProof._id),
          from: 'PROOF_SUBMITTED',
          to: 'UNDER_REVIEW',
          actorUserId: undefined,
          metadata: { system: true },
        });

        res.json(toUiOrder(afterReview.toObject()));
        return;
      } catch (err) {
        next(err);
      }
    },
  };
}
