import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env.js';
import { Types } from 'mongoose';
import { AppError } from '../middleware/errors.js';
import { prisma as db } from '../database/prisma.js';
import { pgOrder } from '../utils/pgMappers.js';
import { createOrderSchema, submitClaimSchema } from '../validations/orders.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiOrder } from '../utils/uiMappers.js';
import { pushOrderEvent, isTerminalAffiliateStatus } from '../services/orderEvents.js';
import { transitionOrderWorkflow } from '../services/orderWorkflow.js';
import type { Role } from '../middleware/auth.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { isGeminiConfigured, verifyProofWithAi, verifyRatingScreenshotWithAi, verifyReturnWindowWithAi } from '../services/aiService.js';

// UUID v4 regex — 8-4-4-4-12 hex with dashes.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { writeAuditLog } from '../services/audit.js';

export function makeOrdersController(env: Env) {
  const MAX_PROOF_BYTES = 50 * 1024 * 1024;
  const MIN_PROOF_BYTES = (env.SEED_E2E || env.NODE_ENV !== 'production') ? 1 : 10 * 1024;

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
      const limitMb = Math.round(MAX_PROOF_BYTES / (1024 * 1024));
      throw new AppError(400, 'PROOF_TOO_LARGE', `${label} exceeds ${limitMb}MB.`);
    }
  };
  const findOrderForProof = async (orderId: string) => {
    const orderWhere = UUID_RE.test(orderId)
      ? { OR: [{ id: orderId }, { mongoId: orderId }] as any, deletedAt: null }
      : { mongoId: orderId, deletedAt: null };
    const byId = await db().order.findFirst({
      where: orderWhere as any,
      include: { items: true },
    });
    if (byId) return pgOrder(byId);
    const byExternal = await db().order.findFirst({
      where: { externalOrderId: orderId, deletedAt: null },
      include: { items: true },
    });
    if (byExternal) return pgOrder(byExternal);
    return null;
  };
  const resolveProofValue = (order: any, proofType: string) => {
    if (proofType === 'order') return order.screenshots?.order || '';
    if (proofType === 'payment') return order.screenshots?.payment || '';
    if (proofType === 'rating') return order.screenshots?.rating || '';
    if (proofType === 'review') return order.reviewLink || order.screenshots?.review || '';
    if (proofType === 'returnwindow') return order.screenshots?.returnWindow || '';
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

            const allowedTypes = new Set(['order', 'payment', 'rating', 'review', 'returnwindow']);
            if (!allowedTypes.has(proofType)) {
              throw new AppError(400, 'INVALID_PROOF_TYPE', 'Invalid proof type');
            }

            const order = await findOrderForProof(orderId);
            if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

            const { roles, user, userId: _userId, pgUserId } = getRequester(req);
            if (!isPrivileged(roles)) {
              let allowed = false;

              if (roles.includes('brand')) {
                const sameBrand = String(order.brandUserId || '') === pgUserId;
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
                  const mediator = await db().user.findFirst({
                    where: {
                      roles: { has: 'mediator' as any },
                      mediatorCode: String(order.managerName || '').trim(),
                      parentCode: agencyCode,
                      deletedAt: null,
                    },
                    select: { id: true },
                  });
                  allowed = !!mediator;
                }
              }

              if (!allowed && roles.includes('mediator')) {
                const mediatorCode = String(user?.mediatorCode || '').trim();
                allowed = !!mediatorCode && String(order.managerName || '').trim() === mediatorCode;
              }

              if (!allowed && roles.includes('shopper')) {
                allowed = String(order.userId || '') === pgUserId;
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
            // Require authentication — prevents unauthenticated enumeration of proof images.
            const requesterId = req.auth?.userId;
            if (!requesterId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');

            const orderId = String(req.params.orderId || '').trim();
            const proofType = String(req.params.type || '').trim().toLowerCase();
            if (!orderId) throw new AppError(400, 'INVALID_ORDER_ID', 'Invalid order id');

            const allowedTypes = new Set(['order', 'payment', 'rating', 'review', 'returnwindow']);
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

        // Resolve mongoId/UUID → PG UUID for FK query
        const userWhere = UUID_RE.test(userId)
          ? { OR: [{ id: userId }, { mongoId: userId }] as any, deletedAt: null }
          : { mongoId: userId, deletedAt: null };
        const targetUser = await db().user.findFirst({ where: userWhere as any, select: { id: true } });
        if (!targetUser) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        const orders = await db().order.findMany({
          where: { userId: targetUser.id, deletedAt: null },
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 2000,
        });

        res.json(orders.map((o: any) => toUiOrder(pgOrder(o))));
      } catch (err) {
        next(err);
      }
    },

    createOrder: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createOrderSchema.parse(req.body);

        const requesterId = req.auth?.userId;
        const requesterRoles = req.auth?.roles ?? [];
        const _pgUserId = (req.auth as any)?.pgUserId ?? '';
        if (!requesterId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
        if (!requesterRoles.includes('shopper')) {
          throw new AppError(403, 'FORBIDDEN', 'Only buyers can create orders');
        }

        if (String(body.userId) !== String(requesterId)) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot create orders for another user');
        }

        const userLookupWhere = UUID_RE.test(body.userId)
          ? { OR: [{ id: body.userId }, { mongoId: body.userId }] as any, deletedAt: null }
          : { mongoId: body.userId, deletedAt: null };
        const user = await db().user.findFirst({ where: userLookupWhere as any });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        const userPgId = user.id;
        const userMongoId = user.mongoId!;

        // Abuse prevention: basic velocity limits (per buyer).
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const [hourly, daily] = await Promise.all([
          db().order.count({ where: { userId: userPgId, createdAt: { gte: oneHourAgo }, deletedAt: null } }),
          db().order.count({ where: { userId: userPgId, createdAt: { gte: oneDayAgo }, deletedAt: null } }),
        ]);
        if (hourly >= 10 || daily >= 30) {
          throw new AppError(429, 'VELOCITY_LIMIT', 'Too many orders created. Please try later.');
        }

        const allowE2eBypass = env.SEED_E2E || env.NODE_ENV !== 'production';
        const resolvedExternalOrderId = body.externalOrderId || (allowE2eBypass ? `E2E-${Date.now()}` : undefined);

        if (resolvedExternalOrderId) {
          const dup = await db().order.findFirst({ where: { externalOrderId: resolvedExternalOrderId, deletedAt: null } });
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
        const duplicateWhere: any = {
          userId: userPgId,
          deletedAt: null,
          workflowStatus: { notIn: ['FAILED', 'REJECTED'] },
          items: { some: { productId: firstItem.productId } },
        };
        if (body.preOrderId) {
          duplicateWhere.mongoId = { not: body.preOrderId };
        }

        const existingDealOrder = await db().order.findFirst({ where: duplicateWhere });
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

        if (!resolvedExternalOrderId && !allowE2eBypass) {
          throw new AppError(400, 'ORDER_ID_REQUIRED', 'Order ID is required to validate proof.');
        }

        if (allowE2eBypass) {
          // E2E/dev runs should not rely on external AI services.
        } else if (isGeminiConfigured(env)) {
          // Use the total paid amount (Grand Total) for verification, not item price.
          // The buyer enters the Grand Total from the order screenshot, which may include
          // shipping, marketplace fees, taxes etc.
          const expectedAmount = body.items.reduce(
            (acc: number, it: any) => acc + (Number(it.priceAtPurchase) || 0) * (Number(it.quantity) || 1),
            0
          );
          // Guard against NaN/Infinity from bad request data
          if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
            throw new AppError(400, 'INVALID_ORDER_AMOUNT', 'Could not compute a valid order amount for verification.');
          }
          const verification = await verifyProofWithAi(env, {
            imageBase64: body.screenshots.order,
            expectedOrderId: resolvedExternalOrderId || body.externalOrderId || '',
            expectedAmount,
          });

          const confidenceThreshold = env.AI_PROOF_CONFIDENCE_THRESHOLD ?? 75;
          if (!verification?.orderIdMatch || !verification?.amountMatch || (verification?.confidenceScore ?? 0) < confidenceThreshold) {
            throw new AppError(
              422,
              'INVALID_ORDER_PROOF',
              `Order proof did not match the order ID and amount (confidence: ${verification?.confidenceScore ?? 0}/${confidenceThreshold}). Please upload a clear, valid proof.`
            );
          }
        } else {
          throw new AppError(503, 'AI_NOT_CONFIGURED', 'Proof validation is not configured.');
        }
        const campaignWhere = UUID_RE.test(item.campaignId)
          ? { OR: [{ id: item.campaignId }, { mongoId: item.campaignId }], deletedAt: null }
          : { mongoId: item.campaignId, deletedAt: null };
        const campaign = await db().campaign.findFirst({
          where: campaignWhere as any,
        });
        if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        if (String((campaign as any).status || '').toLowerCase() !== 'active') {
          throw new AppError(409, 'CAMPAIGN_NOT_ACTIVE', 'Campaign is not active');
        }

        // Non-negotiable isolation: buyer can only place orders for campaigns accessible to their lineage.
        const mediatorUser = await db().user.findFirst({
          where: { roles: { has: 'mediator' as any }, mediatorCode: upstreamMediatorCode, deletedAt: null },
          select: { parentCode: true },
        });
        const upstreamAgencyCode = String((mediatorUser as any)?.parentCode || '').trim();

        // Resolve actual agency name for the order record
        let resolvedAgencyName = 'Partner Agency';
        if (upstreamAgencyCode) {
          const agencyUser = await db().user.findFirst({
            where: { roles: { has: 'agency' as any }, mediatorCode: upstreamAgencyCode, deletedAt: null },
            select: { name: true },
          });
          if (agencyUser?.name) resolvedAgencyName = String(agencyUser.name);
        }

        const allowedAgencyCodes = Array.isArray((campaign as any).allowedAgencyCodes)
          ? ((campaign as any).allowedAgencyCodes as string[]).map((c) => String(c))
          : [];

        const assignmentsRaw = (campaign.assignments && typeof campaign.assignments === 'object' && !Array.isArray(campaign.assignments))
          ? campaign.assignments as Record<string, any>
          : {};
        const hasMediatorAssignment = upstreamMediatorCode ? (upstreamMediatorCode in assignmentsRaw) : false;
        const hasAgencyAccess = upstreamAgencyCode ? allowedAgencyCodes.includes(upstreamAgencyCode) : false;

        if (!hasAgencyAccess && !hasMediatorAssignment) {
          throw new AppError(403, 'FORBIDDEN', 'Campaign is not available for your network');
        }

        // Optimistic slot checks (re-verified atomically inside the transaction below)
        if ((campaign.usedSlots ?? 0) >= (campaign.totalSlots ?? 0)) {
          throw new AppError(409, 'SOLD_OUT', 'Sold Out Globally');
        }

        const assignmentVal = upstreamMediatorCode ? assignmentsRaw[upstreamMediatorCode] : undefined;
        const assigned = upstreamMediatorCode
          ? typeof assignmentVal === 'number'
            ? assignmentVal
            : Number((assignmentVal as any)?.limit ?? 0)
          : 0;
        if (upstreamMediatorCode && assigned > 0) {
          const mediatorSales = await db().order.count({
            where: {
              managerName: upstreamMediatorCode,
              items: { some: { campaignId: campaign.id } },
              status: { not: 'Cancelled' as any },
              deletedAt: null,
            },
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
        const dealWhere = UUID_RE.test(item.productId)
          ? { OR: [{ id: item.productId }, { mongoId: item.productId }] as any, deletedAt: null }
          : { mongoId: item.productId, deletedAt: null };
        const maybeDeal = await db().deal.findFirst({ where: dealWhere as any });
        if (maybeDeal) {
          commissionPaise = maybeDeal.commissionPaise;
        }

        // Atomic slot claim via raw SQL inside transaction to prevent overselling
        const claimSlot = async (tx: any) => {
          const claimed: any[] = await tx.$queryRaw`
            UPDATE campaigns SET "usedSlots" = "usedSlots" + 1
            WHERE id = ${campaign.id}::uuid AND "usedSlots" < "totalSlots" AND "deletedAt" IS NULL
            RETURNING id
          `;
          if (!claimed.length) {
            throw new AppError(409, 'SOLD_OUT', 'Sold Out — another buyer claimed the last slot');
          }
        };

        const created = await db().$transaction(async (tx) => {
          // If this is an upgrade from a redirect-tracked pre-order, update that order instead of creating a new one.
          if (body.preOrderId) {
            const preOrderWhere = UUID_RE.test(body.preOrderId)
              ? { OR: [{ id: body.preOrderId }, { mongoId: body.preOrderId }] as any, userId: userPgId, deletedAt: null }
              : { mongoId: body.preOrderId, userId: userPgId, deletedAt: null };
            const existing = await tx.order.findFirst({
              where: preOrderWhere as any,
              include: { items: true },
            });
            if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pre-order not found');
            if (existing.frozen) throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
            if (String(existing.workflowStatus) !== 'REDIRECTED') {
              throw new AppError(409, 'ORDER_STATE_MISMATCH', 'Pre-order is not in REDIRECTED state');
            }

            // Slot consumption happens on ORDERED — use atomic claim to prevent overselling.
            await claimSlot(tx);

            // Delete old items, then recreate with new data
            await tx.orderItem.deleteMany({ where: { orderId: existing.id } });

            const existingEvents = Array.isArray(existing.events) ? (existing.events as any[]) : [];
            const _updated = await tx.order.update({
              where: { id: existing.id },
              data: {
                brandUserId: campaign.brandUserId,
                items: {
                  create: body.items.map((it) => ({
                    productId: it.productId,
                    title: it.title,
                    image: it.image,
                    priceAtPurchasePaise: rupeesToPaise(it.priceAtPurchase),
                    commissionPaise,
                    campaignId: campaign.id,
                    dealType: it.dealType,
                    quantity: it.quantity,
                    platform: it.platform,
                    brandName: it.brandName,
                  })),
                },
                totalPaise: body.items.reduce(
                  (acc, it) => acc + rupeesToPaise(it.priceAtPurchase) * it.quantity,
                  0
                ),
                status: 'Ordered' as any,
                paymentStatus: 'Pending' as any,
                affiliateStatus: 'Unchecked' as any,
                managerName: upstreamMediatorCode,
                agencyName: resolvedAgencyName,
                buyerName: user.name,
                buyerMobile: user.mobile,
                brandName: item.brandName ?? campaign.brandName,
                externalOrderId: resolvedExternalOrderId,
                ...(body.reviewerName ? { reviewerName: body.reviewerName } : {}),
                // Merge screenshots: preserve existing proofs, overlay new ones
                screenshotOrder: body.screenshots?.order ?? existing.screenshotOrder,
                screenshotPayment: body.screenshots?.payment ?? existing.screenshotPayment,
                screenshotRating: body.screenshots?.rating ?? existing.screenshotRating,
                screenshotReview: body.screenshots?.review ?? existing.screenshotReview,
                screenshotReturnWindow: body.screenshots?.returnWindow ?? existing.screenshotReturnWindow,
                reviewLink: body.reviewLink,
                ...(body.orderDate && !isNaN(new Date(body.orderDate).getTime()) ? { orderDate: new Date(body.orderDate) } : {}),
                ...(body.soldBy ? { soldBy: body.soldBy } : {}),
                ...(body.extractedProductName ? { extractedProductName: body.extractedProductName } : {}),
                events: pushOrderEvent(existingEvents, {
                  type: 'ORDERED',
                  at: new Date(),
                  actorUserId: userMongoId,
                  metadata: { campaignId: String(campaign.mongoId ?? campaign.id), mediatorCode: upstreamMediatorCode },
                }) as any,
                updatedBy: userPgId,
              },
              include: { items: true },
            });

            // State machine: REDIRECTED -> ORDERED
            const transitioned = await transitionOrderWorkflow({
              orderId: existing.mongoId!,
              from: 'REDIRECTED' as any,
              to: 'ORDERED' as any,
              actorUserId: userMongoId,
              metadata: { source: 'createOrder(preOrderId)' },
              tx,
              env,
            });
            return transitioned;
          }

          // Atomic slot claim to prevent overselling under concurrency
          await claimSlot(tx);

          const order = await tx.order.create({
            data: {
              mongoId: new Types.ObjectId().toString(),
              userId: userPgId,
              brandUserId: campaign.brandUserId,
              items: {
                create: body.items.map((it) => ({
                  productId: it.productId,
                  title: it.title,
                  image: it.image,
                  priceAtPurchasePaise: rupeesToPaise(it.priceAtPurchase),
                  commissionPaise,
                  campaignId: campaign.id,
                  dealType: it.dealType,
                  quantity: it.quantity,
                  platform: it.platform,
                  brandName: it.brandName,
                })),
              },
              totalPaise: body.items.reduce(
                (acc, it) => acc + rupeesToPaise(it.priceAtPurchase) * it.quantity,
                0
              ),
              workflowStatus: 'ORDERED' as any,
              status: 'Ordered' as any,
              paymentStatus: 'Pending' as any,
              affiliateStatus: 'Unchecked' as any,
              managerName: upstreamMediatorCode,
              agencyName: resolvedAgencyName,
              buyerName: user.name,
              buyerMobile: user.mobile,
              brandName: item.brandName ?? campaign.brandName,
              externalOrderId: resolvedExternalOrderId,
              ...(body.reviewerName ? { reviewerName: body.reviewerName } : {}),
              screenshotOrder: body.screenshots?.order ?? null,
              screenshotPayment: body.screenshots?.payment ?? null,
              screenshotRating: body.screenshots?.rating ?? null,
              screenshotReview: body.screenshots?.review ?? null,
              screenshotReturnWindow: body.screenshots?.returnWindow ?? null,
              reviewLink: body.reviewLink,
              ...(body.orderDate && !isNaN(new Date(body.orderDate).getTime()) ? { orderDate: new Date(body.orderDate) } : {}),
              ...(body.soldBy ? { soldBy: body.soldBy } : {}),
              ...(body.extractedProductName ? { extractedProductName: body.extractedProductName } : {}),
              events: pushOrderEvent([], {
                type: 'ORDERED',
                at: new Date(),
                actorUserId: userMongoId,
                metadata: { campaignId: String(campaign.mongoId ?? campaign.id), mediatorCode: upstreamMediatorCode },
              }) as any,
              createdBy: userPgId,
            },
            include: { items: true },
          });

          return order;
        });

        // UI often submits the initial order screenshot at creation time.
        // If proof is already present, progress the strict workflow so Ops can verify.
        let finalOrder: any = created;
        const orderMongoId = created?.mongoId ?? '';
        const initialProofTypes: Array<'order' | 'rating' | 'review'> = [];
        if (body.screenshots?.order) initialProofTypes.push('order');
        if (body.screenshots?.rating) initialProofTypes.push('rating');
        if (body.reviewLink) initialProofTypes.push('review');

        if (initialProofTypes.length) {
          // Attach an auditable proof-submitted event.
          const currentEvents = Array.isArray(created?.events) ? (created.events as any[]) : [];
          const updatedEvents = pushOrderEvent(currentEvents, {
            type: 'PROOF_SUBMITTED',
            at: new Date(),
            actorUserId: requesterId,
            metadata: { type: initialProofTypes[0] },
          });
          await db().order.update({
            where: { id: created!.id },
            data: { events: updatedEvents as any },
          });

          const _afterProof = await transitionOrderWorkflow({
            orderId: orderMongoId,
            from: (created?.workflowStatus ?? 'ORDERED') as any,
            to: 'PROOF_SUBMITTED' as any,
            actorUserId: String(requesterId || ''),
            metadata: { proofType: initialProofTypes[0], source: 'createOrder' },
            env,
          });

          finalOrder = await transitionOrderWorkflow({
            orderId: orderMongoId,
            from: 'PROOF_SUBMITTED' as any,
            to: 'UNDER_REVIEW' as any,
            actorUserId: undefined,
            metadata: { system: true, source: 'createOrder' },
            env,
          });
        }

        // Audit trail — write BEFORE sending response so the audit entry is guaranteed
        // even if the client disconnects or the response write fails.
        await writeAuditLog({
          req,
          action: 'ORDER_CREATED',
          entityType: 'Order',
          entityId: orderMongoId,
          metadata: {
            campaignId: String(campaign.mongoId ?? campaign.id),
            total: body.items.reduce((a: number, it: any) => a + (Number(it.priceAtPurchase) || 0) * (Number(it.quantity) || 1), 0),
            externalOrderId: resolvedExternalOrderId,
          },
        }).catch(() => {});

        res
          .status(201)
          .json(toUiOrder(pgOrder(finalOrder)));

        // Notify UIs (buyer/mediator/brand/admin) that order-related views should refresh.
        const privilegedRoles: Role[] = ['admin', 'ops'];
        // Resolve brand user mongoId for realtime audience
        let brandMongoId = '';
        if (campaign.brandUserId) {
          const brandUser = await db().user.findUnique({ where: { id: campaign.brandUserId }, select: { mongoId: true } });
          brandMongoId = brandUser?.mongoId ?? '';
        }
        const audience = {
          roles: privilegedRoles,
          userIds: [userMongoId, brandMongoId].filter(Boolean),
          mediatorCodes: upstreamMediatorCode ? [upstreamMediatorCode] : undefined,
          agencyCodes: upstreamAgencyCode ? [upstreamAgencyCode] : undefined,
        };

        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
      } catch (err) {
        next(err);
      }
    },

    submitClaim: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = submitClaimSchema.parse(req.body);
        const claimOrderWhere = UUID_RE.test(body.orderId)
          ? { OR: [{ id: body.orderId }, { mongoId: body.orderId }] as any, deletedAt: null }
          : { mongoId: body.orderId, deletedAt: null };
        const order = await db().order.findFirst({
          where: claimOrderWhere as any,
          include: { items: true },
        });
        if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if (order.frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        const requesterId = req.auth?.userId;
        const requesterPgId = (req.auth as any)?.pgUserId ?? '';
        const requesterRoles = req.auth?.roles ?? [];
        const privileged = requesterRoles.includes('admin') || requesterRoles.includes('ops');
        if (!privileged && order.userId !== requesterPgId) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot modify other user orders');
        }

        if (isTerminalAffiliateStatus(String(order.affiliateStatus))) {
          throw new AppError(409, 'ORDER_FINALIZED', 'This order is finalized and cannot be modified');
        }

        const wf = String(order.workflowStatus || 'CREATED');
        if (wf !== 'ORDERED' && wf !== 'UNDER_REVIEW' && wf !== 'PROOF_SUBMITTED') {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot submit proof in state ${wf}`);
        }

        // verification is JSONB
        const verification = (order.verification && typeof order.verification === 'object') ? order.verification as any : {};

        // Step-gating: buyer can only upload review/rating AFTER purchase is verified by mediator.
        if (body.type === 'review' || body.type === 'rating') {
          const purchaseVerified = !!verification?.order?.verifiedAt;
          if (!purchaseVerified) {
            throw new AppError(409, 'PURCHASE_NOT_VERIFIED',
              'Purchase proof must be verified by your mediator before uploading additional proofs.');
          }

          // Validate that the deal type actually requires this proof.
          const dealTypes = (order.items ?? []).map((it: any) => String(it?.dealType || ''));
          const requiresReview = dealTypes.includes('Review');
          const requiresRating = dealTypes.includes('Rating');
          if (body.type === 'review' && !requiresReview) {
            throw new AppError(409, 'NOT_REQUIRED', 'This order does not require review proof.');
          }
          if (body.type === 'rating' && !requiresRating) {
            throw new AppError(409, 'NOT_REQUIRED', 'This order does not require rating proof.');
          }
        }

        // Return window step: gated behind rating verification for Rating/Review deals
        if (body.type === 'returnWindow') {
          const purchaseVerified = !!verification?.order?.verifiedAt;
          if (!purchaseVerified) {
            throw new AppError(409, 'PURCHASE_NOT_VERIFIED',
              'Purchase proof must be verified before uploading return window proof.');
          }
          // For Rating/Review deals, rating/review must be verified first
          const dealTypes = (order.items ?? []).map((it: any) => String(it?.dealType || ''));
          const requiresRating = dealTypes.includes('Rating');
          const requiresReview = dealTypes.includes('Review');
          if (requiresRating && !verification?.rating?.verifiedAt) {
            throw new AppError(409, 'RATING_NOT_VERIFIED',
              'Rating proof must be verified before uploading return window proof.');
          }
          if (requiresReview && !verification?.review?.verifiedAt) {
            throw new AppError(409, 'REVIEW_NOT_VERIFIED',
              'Review proof must be verified before uploading return window proof.');
          }
        }

        // Build the update payload incrementally
        const updateData: any = {};
        let aiOrderVerification: any = null;

        if (body.type === 'review') {
          updateData.reviewLink = body.data;
          if (order.rejectionType === 'review') {
            updateData.rejectionType = null;
            updateData.rejectionReason = null;
            updateData.rejectionAt = null;
            updateData.rejectionBy = null;
          }
        } else if (body.type === 'rating') {
          assertProofImageSize(body.data, 'Rating proof');

          // AI verification: check account name matches buyer + product name matches
          let ratingAiResult: any = null;
          if (!env.SEED_E2E) {
            const buyerUser = await db().user.findUnique({
              where: { id: order.userId },
              select: { name: true },
            });
            const buyerName = String(buyerUser?.name || order.buyerName || '').trim();
            const productName = String((order.items?.[0] as any)?.title || order.extractedProductName || '').trim();
            const reviewerName = String(order.reviewerName || '').trim();
            if (buyerName && productName) {
              ratingAiResult = await verifyRatingScreenshotWithAi(env, {
                imageBase64: body.data,
                expectedBuyerName: buyerName,
                expectedProductName: productName,
                ...(reviewerName ? { expectedReviewerName: reviewerName } : {}),
              });
              // Block submission if both name AND product mismatch with high confidence (≥70 for anti-fraud strength)
              if (ratingAiResult && !ratingAiResult.accountNameMatch && !ratingAiResult.productNameMatch
                  && ratingAiResult.confidenceScore >= 70) {
                throw new AppError(422, 'RATING_VERIFICATION_FAILED',
                  'Rating screenshot does not match: the account name and product must match your order. ' +
                  (ratingAiResult.discrepancyNote || ''));
              }
            }
          }

          updateData.screenshotRating = body.data;
          if (ratingAiResult) {
            updateData.ratingAiVerification = {
              accountNameMatch: ratingAiResult.accountNameMatch,
              productNameMatch: ratingAiResult.productNameMatch,
              detectedAccountName: ratingAiResult.detectedAccountName,
              detectedProductName: ratingAiResult.detectedProductName,
              confidenceScore: ratingAiResult.confidenceScore,
            };

            // Audit trail: record AI rating verification for backtracking
            writeAuditLog({
              req,
              action: 'AI_RATING_VERIFICATION',
              entityType: 'Order',
              entityId: order.mongoId!,
              metadata: {
                accountNameMatch: ratingAiResult.accountNameMatch,
                productNameMatch: ratingAiResult.productNameMatch,
                confidenceScore: ratingAiResult.confidenceScore,
                detectedAccountName: ratingAiResult.detectedAccountName,
                detectedProductName: ratingAiResult.detectedProductName,
                discrepancyNote: ratingAiResult.discrepancyNote,
              },
            });
          }
          if (order.rejectionType === 'rating') {
            updateData.rejectionType = null;
            updateData.rejectionReason = null;
            updateData.rejectionAt = null;
            updateData.rejectionBy = null;
          }
        } else if (body.type === 'returnWindow') {
          assertProofImageSize(body.data, 'Return window proof');

          // AI verification: check order ID, product name, amount, sold by
          let returnWindowResult: any = null;
          if (!env.SEED_E2E) {
            const expectedOrderId = String(order.externalOrderId || '').trim();
            const expectedProductName = String((order.items?.[0] as any)?.title || '').trim();
            const expectedAmount = (order.items ?? []).reduce(
              (acc: number, it: any) => acc + (Number(it?.priceAtPurchasePaise) || 0) * (Number(it?.quantity) || 1), 0
            ) / 100;
            const expectedSoldBy = String(order.soldBy || '').trim();
            if (expectedOrderId) {
              returnWindowResult = await verifyReturnWindowWithAi(env, {
                imageBase64: body.data,
                expectedOrderId,
                expectedProductName,
                expectedAmount,
                expectedSoldBy: expectedSoldBy || undefined,
              });
            }
          }

          updateData.screenshotReturnWindow = body.data;
          if (returnWindowResult) {
            updateData.returnWindowAiVerification = returnWindowResult;
            // Audit trail: record AI return-window verification for backtracking
            writeAuditLog({
              req,
              action: 'AI_RETURN_WINDOW_VERIFICATION',
              entityType: 'Order',
              entityId: order.mongoId!,
              metadata: {
                orderIdMatch: returnWindowResult.orderIdMatch,
                productNameMatch: returnWindowResult.productNameMatch,
                amountMatch: returnWindowResult.amountMatch,
                confidenceScore: returnWindowResult.confidenceScore,
              },
            });
          }
          if (order.rejectionType === 'returnWindow') {
            updateData.rejectionType = null;
            updateData.rejectionReason = null;
            updateData.rejectionAt = null;
            updateData.rejectionBy = null;
          }
        } else if (body.type === 'order') {
          assertProofImageSize(body.data, 'Order proof');
          const expectedOrderId = String(order.externalOrderId || '').trim();

          if (env.SEED_E2E) {
            // E2E runs should not rely on external AI services.
          } else if (isGeminiConfigured(env) && expectedOrderId) {
            const expectedAmount = (order.items ?? []).reduce(
              (acc: number, it: any) => acc + (Number(it?.priceAtPurchasePaise) || 0) * (Number(it?.quantity) || 1), 0
            ) / 100;
            // Guard against NaN/Infinity from corrupted order data
            if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
              console.warn(`[ordersController] Skipping AI re-upload verification: invalid expectedAmount=${expectedAmount} for order=${order.mongoId}`);
            } else {
              aiOrderVerification = await verifyProofWithAi(env, {
                imageBase64: body.data,
                expectedOrderId,
                expectedAmount,
              });
            }
          }

          updateData.screenshotOrder = body.data;
          if (order.rejectionType === 'order') {
            updateData.rejectionType = null;
            updateData.rejectionReason = null;
            updateData.rejectionAt = null;
            updateData.rejectionBy = null;
          }

          // Audit trail: record AI purchase proof verification for backtracking
          if (aiOrderVerification) {
            writeAuditLog({
              req,
              action: 'AI_PURCHASE_PROOF_VERIFICATION',
              entityType: 'Order',
              entityId: order.mongoId!,
              metadata: {
                orderIdMatch: aiOrderVerification.orderIdMatch,
                amountMatch: aiOrderVerification.amountMatch,
                confidenceScore: aiOrderVerification.confidenceScore,
              },
            });
          }
        }

        // Filter missingProofRequests
        const currentMPR = Array.isArray(order.missingProofRequests) ? (order.missingProofRequests as any[]) : [];
        updateData.missingProofRequests = currentMPR.filter(
          (r: any) => String(r?.type) !== String(body.type)
        );

        // Persist marketplace reviewer/profile name if provided alongside any proof upload
        if (body.reviewerName) {
          updateData.reviewerName = body.reviewerName;
        }

        const affiliateStatus = String(order.affiliateStatus || '');
        if (affiliateStatus === 'Fraud_Alert') {
          throw new AppError(409, 'ORDER_FRAUD_FLAGGED', 'This order is flagged for fraud and requires admin review');
        }
        if (affiliateStatus === 'Rejected') {
          updateData.affiliateStatus = 'Unchecked';
        }

        // Push event
        const currentEvents = Array.isArray(order.events) ? (order.events as any[]) : [];
        updateData.events = pushOrderEvent(currentEvents, {
          type: 'PROOF_SUBMITTED',
          at: new Date(),
          actorUserId: requesterId,
          metadata: {
            type: body.type,
            ...(body.type === 'order' && aiOrderVerification ? { aiVerification: aiOrderVerification } : {}),
          },
        });

        await db().order.update({ where: { id: order.id }, data: updateData });

        // Strict state machine progression for first proof submission:
        // ORDERED -> PROOF_SUBMITTED -> UNDER_REVIEW
        // If already UNDER_REVIEW, we just persist the new proof without rewinding workflow.
        if (wf === 'UNDER_REVIEW') {
          const refreshed = await db().order.findUnique({ where: { id: order.id }, include: { items: true } });
          res.json(toUiOrder(pgOrder(refreshed)));
          return;
        }

        const _afterProof = await transitionOrderWorkflow({
          orderId: order.mongoId!,
          from: order.workflowStatus as any,
          to: 'PROOF_SUBMITTED' as any,
          actorUserId: String(requesterId || ''),
          metadata: { proofType: body.type },
          env,
        });

        const afterReview = await transitionOrderWorkflow({
          orderId: order.mongoId!,
          from: 'PROOF_SUBMITTED' as any,
          to: 'UNDER_REVIEW' as any,
          actorUserId: undefined,
          metadata: { system: true },
          env,
        });

        res.json(toUiOrder(pgOrder(afterReview)));

        const privilegedRoles: Role[] = ['admin', 'ops'];
        const managerCode = String(order.managerName || '').trim();
        const mediatorUser = managerCode
          ? await db().user.findFirst({
              where: { roles: { has: 'mediator' as any }, mediatorCode: managerCode, deletedAt: null },
              select: { parentCode: true },
            })
          : null;
        const upstreamAgencyCode = String(mediatorUser?.parentCode || '').trim();

        // Resolve mongoIds for realtime audience
        const orderUser = await db().user.findUnique({ where: { id: order.userId }, select: { mongoId: true } });
        const brandUser = order.brandUserId
          ? await db().user.findUnique({ where: { id: order.brandUserId }, select: { mongoId: true } })
          : null;

        const audience = {
          roles: privilegedRoles,
          userIds: [orderUser?.mongoId ?? '', brandUser?.mongoId ?? ''].filter(Boolean),
          mediatorCodes: managerCode ? [managerCode] : undefined,
          agencyCodes: upstreamAgencyCode ? [upstreamAgencyCode] : undefined,
        };

        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        // Audit log: proof submission
        await writeAuditLog({
          req, action: 'PROOF_SUBMITTED', entityType: 'Order',
          entityId: order.mongoId!,
          metadata: { proofType: body.type },
        }).catch(() => {});
        return;
      } catch (err) {
        next(err);
      }
    },
  };
}
