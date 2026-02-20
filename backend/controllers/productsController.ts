import type { Request, Response, NextFunction } from 'express';
import { DealModel } from '../models/Deal.js';
import { AppError } from '../middleware/errors.js';
import { toUiDeal } from '../utils/uiMappers.js';
import { buildMediatorCodeRegex, normalizeMediatorCode } from '../utils/mediatorCode.js';
import { OrderModel } from '../models/Order.js';
import { CampaignModel } from '../models/Campaign.js';
import { pushOrderEvent } from '../services/orderEvents.js';
import { writeAuditLog } from '../services/audit.js';
import { publishRealtime } from '../services/realtimeHub.js';

export function makeProductsController() {
  return {
    listProducts: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requester = req.auth?.user;
        const requesterRoles = req.auth?.roles ?? [];
        if (!requester || !requesterRoles.includes('shopper')) {
          throw new AppError(403, 'FORBIDDEN', 'Only buyers can list products');
        }

        // Buyers can ONLY see deals assigned to their mediator.
        const mediatorCode = normalizeMediatorCode((requester as any).parentCode);
        if (!mediatorCode) {
          res.json([]);
          return;
        }

        const mediatorRegex = buildMediatorCodeRegex(mediatorCode);
        if (!mediatorRegex) {
          res.json([]);
          return;
        }

        const deals = await DealModel.find({
          mediatorCode: mediatorRegex,
          active: true,
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .limit(2000)
          .lean();

        res.json(deals.map(toUiDeal));
      } catch (err) {
        next(err);
      }
    },

    trackRedirect: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const requester = req.auth?.user;
        const requesterId = req.auth?.userId;
        const requesterRoles = req.auth?.roles ?? [];
        if (!requester || !requesterId || !requesterRoles.includes('shopper')) {
          throw new AppError(403, 'FORBIDDEN', 'Only buyers can access redirect tracking');
        }

        const dealId = String(req.params.dealId || '').trim();
        if (!dealId) throw new AppError(400, 'INVALID_DEAL_ID', 'dealId required');

        const mediatorCode = normalizeMediatorCode((requester as any).parentCode);
        if (!mediatorCode) throw new AppError(409, 'MISSING_MEDIATOR_LINK', 'Your account is not linked to a mediator');

        const mediatorRegex = buildMediatorCodeRegex(mediatorCode);
        if (!mediatorRegex) throw new AppError(409, 'MISSING_MEDIATOR_LINK', 'Your account is not linked to a mediator');

        const deal = await DealModel.findOne({
          _id: dealId,
          mediatorCode: mediatorRegex,
          active: true,
          deletedAt: null,
        }).lean();
        if (!deal) throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');

        const campaign = await CampaignModel.findById((deal as any).campaignId).select({ brandUserId: 1, brandName: 1, deletedAt: 1 }).lean();
        if (!campaign || (campaign as any).deletedAt) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        const preOrder = await OrderModel.create({
          userId: (requester as any)._id,
          brandUserId: (campaign as any).brandUserId,
          items: [
            {
              productId: String((deal as any)._id),
              title: String((deal as any).title),
              image: String((deal as any).image),
              priceAtPurchasePaise: Number((deal as any).pricePaise ?? 0),
              commissionPaise: Number((deal as any).commissionPaise ?? 0),
              campaignId: (deal as any).campaignId,
              dealType: String((deal as any).dealType),
              quantity: 1,
              platform: String((deal as any).platform ?? ''),
              brandName: String((deal as any).brandName ?? (campaign as any).brandName ?? ''),
            },
          ],
          totalPaise: 0,
          workflowStatus: 'REDIRECTED',
          status: 'Ordered',
          paymentStatus: 'Pending',
          affiliateStatus: 'Unchecked',
          managerName: mediatorCode,
          agencyName: 'Partner Agency',
          buyerName: String((requester as any).name || ''),
          buyerMobile: String((requester as any).mobile || ''),
          brandName: String((deal as any).brandName ?? (campaign as any).brandName ?? ''),
          events: pushOrderEvent([], {
            type: 'WORKFLOW_TRANSITION',
            at: new Date(),
            actorUserId: requesterId,
            metadata: { from: 'CREATED', to: 'REDIRECTED', dealId, campaignId: String((deal as any).campaignId) },
          }),
          createdBy: requesterId as any,
        });

        writeAuditLog({
          req,
          action: 'ORDER_REDIRECT_CREATED',
          entityType: 'Order',
          entityId: String((preOrder as any)._id),
          metadata: { dealId, campaignId: String((deal as any).campaignId), mediatorCode },
        });

        const ts = new Date().toISOString();
        publishRealtime({
          type: 'orders.changed',
          ts,
          payload: { orderId: String((preOrder as any)._id), dealId },
          audience: {
            userIds: [requesterId, String((campaign as any).brandUserId)].filter(Boolean),
            roles: ['admin', 'ops'],
          },
        });

        res.status(201).json({
          preOrderId: String((preOrder as any)._id),
          url: String((deal as any).productUrl),
        });
      } catch (err) {
        next(err);
      }
    },
  };
}
