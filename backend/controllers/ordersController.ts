import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
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
import type { Role } from '../middleware/auth.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { isGeminiConfigured, verifyProofWithAi } from '../services/aiService.js';

export function makeOrdersController(env: Env) {
  const MAX_PROOF_BYTES = 5 * 1024 * 1024;
  const MIN_PROOF_BYTES = 10 * 1024;

  const getDataUrlByteSize = (raw: string) => {
    const match = String(raw || '').match(/^data:[^;]+;base64,(.+)$/i);
    if (!match) return 0;
    const base64 = match[1] || '';
    return Math.floor((base64.length * 3) / 4);
  };

  const assertProofImageSize = (raw: string, label: string) => {
    const size = getDataUrlByteSize(raw);
    if (!size || size < MIN_PROOF_BYTES) {
      throw new AppError(400, 'INVALID_PROOF_IMAGE', `${label} is too small or invalid.`);
    }
    if (size > MAX_PROOF_BYTES) {
      throw new AppError(400, 'PROOF_TOO_LARGE', `${label} exceeds 5MB.`);
    }
  };
  const findOrderForProof = async (orderId: string) => {
    const byId = await OrderModel.findById(orderId).lean();
    if (byId && !byId.deletedAt) return byId;
    const byExternal = await OrderModel.findOne({ externalOrderId: orderId, deletedAt: null }).lean();
    if (byExternal) return byExternal;
    return null;
  };
  const resolveProofValue = (order: any, proofType: string) => {
    if (proofType === 'order') return order.screenshots?.order || '';
    if (proofType === 'payment') return order.screenshots?.payment || '';
    if (proofType === 'rating') return order.screenshots?.rating || '';
    if (proofType === 'review') return order.reviewLink || order.screenshots?.review || '';
    return '';
  };

  const sendProofResponse = (res: Response, rawValue: string) => {
    const raw = String(rawValue || '').trim();
    if (!raw) throw new AppError(404, 'PROOF_NOT_FOUND', 'Proof not found');

    if (/^https?:\/\//i.test(raw)) {
      res.redirect(raw);
      return;
    }

    const dataMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataMatch) {
      const mime = dataMatch[1] || 'image/jpeg';
      const payload = dataMatch[2] || '';
      const buffer = Buffer.from(payload, 'base64');
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buffer.length.toString());
      res.send(buffer);
      return;
    }

    try {
      const buffer = Buffer.from(raw, 'base64');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', buffer.length.toString());
      res.send(buffer);
    } catch {
      throw new AppError(415, 'UNSUPPORTED_PROOF_FORMAT', 'Unsupported proof format');
    }
  };

  return {
        getOrderProof: async (req: Request, res: Response, next: NextFunction) => {
          try {
            const orderId = String(req.params.orderId || '').trim();
            const proofType = String(req.params.type || '').trim().toLowerCase();
            if (!orderId) throw new AppError(400, 'INVALID_ORDER_ID', 'Invalid order id');

            const allowedTypes = new Set(['order', 'payment', 'rating', 'review']);
            if (!allowedTypes.has(proofType)) {
              throw new AppError(400, 'INVALID_PROOF_TYPE', 'Invalid proof type');
            }

            const order = await findOrderForProof(orderId);
            if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

            const { roles, user, userId } = getRequester(req);
            if (!isPrivileged(roles)) {
              let allowed = false;

              if (roles.includes('brand')) {
                const sameBrand = String(order.brandUserId || '') === String(user?._id || userId);
                const brandName = String(order.brandName || '').trim();
                const sameBrandName = !!brandName && brandName === String(user?.name || '').trim();
                allowed = sameBrand || sameBrandName;
              }

              if (!allowed && roles.includes('agency')) {
                const agencyCode = String(user?.mediatorCode || '').trim();
                const agencyName = String(user?.name || '').trim();
                if (agencyName && String(order.agencyName || '').trim() === agencyName) {
                  allowed = true;
                } else if (agencyCode && String(order.managerName || '').trim()) {
                  const mediator = await UserModel.findOne({
                    roles: 'mediator',
                    mediatorCode: String(order.managerName || '').trim(),
                    parentCode: agencyCode,
                    deletedAt: null,
                  })
                    .select({ _id: 1 })
                    .lean();
                  allowed = !!mediator;
                }
              }

              if (!allowed && roles.includes('mediator')) {
                const mediatorCode = String(user?.mediatorCode || '').trim();
                allowed = !!mediatorCode && String(order.managerName || '').trim() === mediatorCode;
              }

              if (!allowed && roles.includes('shopper')) {
                allowed = String(order.userId || '') === String(user?._id || userId);
              }

              if (!allowed) throw new AppError(403, 'FORBIDDEN', 'Not allowed to access proof');
            }

            const proofValue = resolveProofValue(order, proofType);
            sendProofResponse(res, proofValue);
          } catch (err) {
            next(err);
          }
        },

        getOrderProofPublic: async (req: Request, res: Response, next: NextFunction) => {
          try {
            const orderId = String(req.params.orderId || '').trim();
            const proofType = String(req.params.type || '').trim().toLowerCase();
            if (!orderId) throw new AppError(400, 'INVALID_ORDER_ID', 'Invalid order id');

            const allowedTypes = new Set(['order', 'payment', 'rating', 'review']);
            if (!allowedTypes.has(proofType)) {
              throw new AppError(400, 'INVALID_PROOF_TYPE', 'Invalid proof type');
            }

            const order = await findOrderForProof(orderId);
            if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

            const proofValue = resolveProofValue(order, proofType);
            sendProofResponse(res, proofValue);
          } catch (err) {
            next(err);
          }
        },
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

        // CRITICAL ANTI-FRAUD: Prevent duplicate orders for the same deal by the same buyer.
        // Important: allow upgrading a redirect-tracked pre-order (preOrderId) into a real order.
        const firstItem = body.items[0];
        const duplicateQuery: any = {
          userId: user._id,
          'items.0.productId': firstItem.productId,
          deletedAt: null,
          workflowStatus: { $nin: ['FAILED', 'REJECTED'] },
        };
        if (body.preOrderId) {
          duplicateQuery._id = { $ne: body.preOrderId };
        }

        const existingDealOrder = await OrderModel.findOne(duplicateQuery);
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
        if (!body.screenshots?.order) {
          throw new AppError(400, 'ORDER_PROOF_REQUIRED', 'Order proof image is required.');
        }
        assertProofImageSize(body.screenshots.order, 'Order proof');

        if (body.screenshots?.rating) {
          assertProofImageSize(body.screenshots.rating, 'Rating proof');
        }

        if (!body.externalOrderId) {
          throw new AppError(400, 'ORDER_ID_REQUIRED', 'Order ID is required to validate proof.');
        }

        if (env.SEED_E2E) {
          // E2E runs should not rely on external AI services.
        } else if (isGeminiConfigured(env)) {
          const verification = await verifyProofWithAi(env, {
            imageBase64: body.screenshots.order,
            expectedOrderId: body.externalOrderId,
            expectedAmount: Number(item.priceAtPurchase) || 0,
          });

          if (!verification?.orderIdMatch || !verification?.amountMatch || verification?.confidenceScore < 60) {
            throw new AppError(
              422,
              'INVALID_ORDER_PROOF',
              'Order proof did not match the order ID and amount. Please upload a valid proof.'
            );
          }
        } else {
          throw new AppError(503, 'AI_NOT_CONFIGURED', 'Proof validation is not configured.');
        }
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
              env,
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
            env,
          });

          finalOrder = await transitionOrderWorkflow({
            orderId: String((afterProof as any)._id),
            from: 'PROOF_SUBMITTED',
            to: 'UNDER_REVIEW',
            actorUserId: undefined,
            metadata: { system: true, source: 'createOrder' },
            env,
          });
        }

        res
          .status(201)
          .json(toUiOrder(finalOrder.toObject ? finalOrder.toObject() : (finalOrder as any)));

        // Notify UIs (buyer/mediator/brand/admin) that order-related views should refresh.
        const privilegedRoles: Role[] = ['admin', 'ops'];
        const audience = {
          roles: privilegedRoles,
          userIds: [String(user._id), String((campaign as any).brandUserId || '')].filter(Boolean),
          mediatorCodes: upstreamMediatorCode ? [upstreamMediatorCode] : undefined,
          agencyCodes: upstreamAgencyCode ? [upstreamAgencyCode] : undefined,
        };

        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
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
          if ((order as any).rejection?.type === 'review') {
            (order as any).rejection = undefined;
          }
        } else if (body.type === 'rating') {
          assertProofImageSize(body.data, 'Rating proof');
          order.screenshots = { ...(order.screenshots ?? {}), rating: body.data } as any;
          if ((order as any).rejection?.type === 'rating') {
            (order as any).rejection = undefined;
          }
        } else if (body.type === 'order') {
          assertProofImageSize(body.data, 'Order proof');
          const expectedOrderId = String(order.externalOrderId || '').trim();
          if (!expectedOrderId) {
            throw new AppError(400, 'ORDER_ID_REQUIRED', 'Order ID is required to validate proof.');
          }
          if (env.SEED_E2E) {
            // E2E runs should not rely on external AI services.
          } else if (isGeminiConfigured(env)) {
            const expectedAmount = Number((order as any).items?.[0]?.priceAtPurchasePaise || 0) / 100;
            const verification = await verifyProofWithAi(env, {
              imageBase64: body.data,
              expectedOrderId,
              expectedAmount,
            });

            if (!verification?.orderIdMatch || !verification?.amountMatch || verification?.confidenceScore < 60) {
              throw new AppError(
                422,
                'INVALID_ORDER_PROOF',
                'Order proof did not match the order ID and amount. Please upload a valid proof.'
              );
            }
          } else {
            throw new AppError(503, 'AI_NOT_CONFIGURED', 'Proof validation is not configured.');
          }

          order.screenshots = { ...(order.screenshots ?? {}), order: body.data } as any;
          if ((order as any).rejection?.type === 'order') {
            (order as any).rejection = undefined;
          }
        }

        const affiliateStatus = String(order.affiliateStatus || '');
        if (affiliateStatus === 'Rejected' || affiliateStatus === 'Fraud_Alert') {
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
          env,
        });

        const afterReview = await transitionOrderWorkflow({
          orderId: String(afterProof._id),
          from: 'PROOF_SUBMITTED',
          to: 'UNDER_REVIEW',
          actorUserId: undefined,
          metadata: { system: true },
          env,
        });

        res.json(toUiOrder(afterReview.toObject()));

        const privilegedRoles: Role[] = ['admin', 'ops'];
        const managerCode = String((order as any).managerName || '').trim();
        const mediatorUser = managerCode
          ? await UserModel.findOne({ roles: 'mediator', mediatorCode: managerCode, deletedAt: null })
              .select({ parentCode: 1 })
              .lean()
          : null;
        const upstreamAgencyCode = String((mediatorUser as any)?.parentCode || '').trim();

        const audience = {
          roles: privilegedRoles,
          userIds: [String((order as any).userId || ''), String((order as any).brandUserId || '')].filter(Boolean),
          mediatorCodes: managerCode ? [managerCode] : undefined,
          agencyCodes: upstreamAgencyCode ? [upstreamAgencyCode] : undefined,
        };

        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        return;
      } catch (err) {
        next(err);
      }
    },
  };
}
