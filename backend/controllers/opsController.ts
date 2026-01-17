import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import type { Role } from '../middleware/auth.js';
import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { CampaignModel } from '../models/Campaign.js';
import { OrderModel } from '../models/Order.js';
import { TicketModel } from '../models/Ticket.js';
import { DealModel } from '../models/Deal.js';
import { PayoutModel } from '../models/Payout.js';
import { TransactionModel } from '../models/Transaction.js';
import {
  approveByIdSchema,
  assignSlotsSchema,
  createCampaignSchema,
  payoutMediatorSchema,
  publishDealSchema,
  rejectByIdSchema,
  settleOrderSchema,
  unsettleOrderSchema,
  verifyOrderRequirementSchema,
  verifyOrderSchema,
} from '../validations/ops.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiCampaign, toUiDeal, toUiOrder, toUiUser } from '../utils/uiMappers.js';
import { ensureWallet, applyWalletDebit, applyWalletCredit } from '../services/walletService.js';
import { getRequester, isPrivileged, requireAnyRole } from '../services/authz.js';
import { listMediatorCodesForAgency, getAgencyCodeForMediatorCode, isAgencyActive, isMediatorActive } from '../services/lineage.js';
import { pushOrderEvent } from '../services/orderEvents.js';
import { writeAuditLog } from '../services/audit.js';
import { requestBrandConnectionSchema } from '../validations/connections.js';
import { transitionOrderWorkflow } from '../services/orderWorkflow.js';
import { publishRealtime } from '../services/realtimeHub.js';

function buildOrderAudience(order: any, agencyCode?: string) {
  const privilegedRoles: Role[] = ['admin', 'ops'];
  const managerCode = String(order?.managerName || '').trim();
  const brandUserId = String(order?.brandUserId || '').trim();
  const buyerUserId = String(order?.userId || '').trim();
  const normalizedAgencyCode = String(agencyCode || '').trim();

  return {
    roles: privilegedRoles,
    userIds: [buyerUserId, brandUserId].filter(Boolean),
    mediatorCodes: managerCode ? [managerCode] : undefined,
    agencyCodes: normalizedAgencyCode ? [normalizedAgencyCode] : undefined,
  };
}

function mapUsersWithWallets(users: any[], wallets: any[]) {
  const byUserId = new Map<string, any>();
  for (const w of wallets) byUserId.set(String(w.ownerUserId), w);
  return users.map((u) => toUiUser(u, byUserId.get(String(u._id))));
}

function getRequiredStepsForOrder(order: any): Array<'review' | 'rating'> {
  const dealTypes = (order.items ?? [])
    .map((it: any) => String(it?.dealType || ''))
    .filter(Boolean);
  const requiresReview = dealTypes.includes('Review');
  const requiresRating = dealTypes.includes('Rating');
  return [
    ...(requiresReview ? (['review'] as const) : []),
    ...(requiresRating ? (['rating'] as const) : []),
  ];
}

function hasProofForRequirement(order: any, type: 'review' | 'rating'): boolean {
  if (type === 'review') return !!(order.reviewLink || order.screenshots?.review);
  return !!order.screenshots?.rating;
}

function isRequirementVerified(order: any, type: 'review' | 'rating'): boolean {
  return !!order.verification?.[type]?.verifiedAt;
}

async function finalizeApprovalIfReady(order: any, actorUserId: string) {
  const wf = String(order.workflowStatus || 'CREATED');
  if (wf !== 'UNDER_REVIEW') return { approved: false, reason: 'NOT_UNDER_REVIEW' };

  if (!order.verification?.order?.verifiedAt) {
    return { approved: false, reason: 'PURCHASE_NOT_VERIFIED' };
  }

  const required = getRequiredStepsForOrder(order);
  const missingProofs = required.filter((t) => !hasProofForRequirement(order, t));
  if (missingProofs.length) return { approved: false, reason: 'MISSING_PROOFS', missingProofs };

  const missingVerifications = required.filter((t) => !isRequirementVerified(order, t));
  if (missingVerifications.length) {
    return { approved: false, reason: 'MISSING_VERIFICATIONS', missingVerifications };
  }

  order.affiliateStatus = 'Pending_Cooling';
  const settleDate = new Date();
  settleDate.setDate(settleDate.getDate() + 14);
  order.expectedSettlementDate = settleDate;
  order.events = pushOrderEvent(order.events as any, {
    type: 'VERIFIED',
    at: new Date(),
    actorUserId,
    metadata: { step: 'finalize' },
  }) as any;

  await order.save();

  await transitionOrderWorkflow({
    orderId: String(order._id),
    from: 'UNDER_REVIEW',
    to: 'APPROVED',
    actorUserId: String(actorUserId || ''),
    metadata: { source: 'finalizeApprovalIfReady' },
  });

  return { approved: true };
}
export function makeOpsController() {
  return {
    requestBrandConnection: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = requestBrandConnectionSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);
        if (!roles.includes('agency')) {
          throw new AppError(403, 'FORBIDDEN', 'Only agencies can request brand connection');
        }

        const agencyCode = String((requester as any)?.mediatorCode || '').trim();
        if (!agencyCode) throw new AppError(409, 'MISSING_AGENCY_CODE', 'Agency is missing a code');

        const brand = await UserModel.findOne({ brandCode: body.brandCode, roles: 'brand', deletedAt: null });
        if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
        if (brand.status !== 'active') throw new AppError(409, 'BRAND_SUSPENDED', 'Brand is not active');

        const agencyName = String((requester as any)?.name || 'Agency');

        const updated = await UserModel.updateOne(
          {
            _id: brand._id,
            connectedAgencies: { $ne: agencyCode },
            'pendingConnections.agencyCode': { $ne: agencyCode },
          },
          {
            $push: {
              pendingConnections: {
                agencyId: String((requester as any)?._id),
                agencyName,
                agencyCode,
                timestamp: new Date(),
              },
            },
          }
        );

        if (!updated.modifiedCount) {
          throw new AppError(409, 'ALREADY_REQUESTED', 'Connection already exists or is already pending');
        }

        await writeAuditLog({
          req,
          action: 'BRAND_CONNECTION_REQUESTED',
          entityType: 'User',
          entityId: String(brand._id),
          metadata: { agencyCode, brandCode: body.brandCode },
        });

        // Realtime: let the brand (and agency) UIs update without refresh.
        const privilegedRoles: Role[] = ['admin', 'ops'];
        const audience = {
          roles: privilegedRoles,
          userIds: [String(brand._id), String((requester as any)?._id || '')].filter(Boolean),
          agencyCodes: agencyCode ? [agencyCode] : undefined,
        };
        publishRealtime({ type: 'users.changed', ts: new Date().toISOString(), payload: { userId: String(brand._id) }, audience });
        publishRealtime({
          type: 'users.changed',
          ts: new Date().toISOString(),
          payload: { userId: String((requester as any)?._id || '') },
          audience,
        });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
    getMediators: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requested = typeof req.query.agencyCode === 'string' ? req.query.agencyCode : '';

        const agencyCode = isPrivileged(roles) ? requested : String((user as any)?.mediatorCode || '');
        if (!agencyCode) throw new AppError(400, 'INVALID_AGENCY_CODE', 'agencyCode required');
        if (!isPrivileged(roles)) requireAnyRole(roles, 'agency');

        const mediators = await UserModel.find({
          roles: 'mediator',
          parentCode: agencyCode,
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .lean();

        const wallets = await WalletModel.find({ ownerUserId: { $in: mediators.map((m) => m._id) } }).lean();
        res.json(mapUsersWithWallets(mediators, wallets));
      } catch (err) {
        next(err);
      }
    },

    getCampaigns: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requested = typeof req.query.mediatorCode === 'string' ? req.query.mediatorCode : undefined;

        // Scope campaigns by requester unless admin/ops.
        const code = isPrivileged(roles) ? requested : String((user as any)?.mediatorCode || '');

        const query: any = { deletedAt: null };
        if (code) {
          // Agency visibility must include campaigns assigned to any of its sub-mediators.
          // Otherwise, ops/admin assigning slots directly to mediator codes makes the campaign
          // invisible to the parent agency portal.
          if (!isPrivileged(roles) && roles.includes('agency')) {
            const mediatorCodes = await listMediatorCodesForAgency(code);
            const assignmentOr = mediatorCodes
              .filter(Boolean)
              .map((mc) => ({ [`assignments.${mc}`]: { $exists: true } }));

            query.$or = [{ allowedAgencyCodes: code }, ...assignmentOr];
          } else {
            query.$or = [{ allowedAgencyCodes: code }, { [`assignments.${code}`]: { $exists: true } }];
          }
        }

        const campaigns = await CampaignModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        res.json(campaigns.map(toUiCampaign));
      } catch (err) {
        next(err);
      }
    },

    getDeals: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requestedCode = typeof req.query.mediatorCode === 'string' ? req.query.mediatorCode : '';

        let mediatorCodes: string[] = [];
        if (isPrivileged(roles)) {
          if (!requestedCode) throw new AppError(400, 'INVALID_CODE', 'mediatorCode required');
          const requestedRole = typeof req.query.role === 'string' ? req.query.role : '';
          if (requestedRole === 'agency') {
            mediatorCodes = await listMediatorCodesForAgency(requestedCode);
          } else {
            mediatorCodes = [requestedCode];
          }
        } else if (roles.includes('mediator')) {
          mediatorCodes = [String((user as any)?.mediatorCode || '')];
        } else if (roles.includes('agency')) {
          mediatorCodes = await listMediatorCodesForAgency(String((user as any)?.mediatorCode || ''));
        } else {
          throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
        }

        mediatorCodes = mediatorCodes.filter(Boolean);
        if (!mediatorCodes.length) {
          res.json([]);
          return;
        }

        const deals = await DealModel.find({
          mediatorCode: { $in: mediatorCodes },
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();

        res.json(deals.map(toUiDeal));
      } catch (err) {
        next(err);
      }
    },
    getOrders: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requestedCode = typeof req.query.mediatorCode === 'string' ? req.query.mediatorCode : '';

        let managerCodes: string[] = [];
        if (isPrivileged(roles)) {
          if (!requestedCode) throw new AppError(400, 'INVALID_CODE', 'mediatorCode required');
          const requestedRole = typeof req.query.role === 'string' ? req.query.role : '';
          if (requestedRole === 'agency') {
            managerCodes = await listMediatorCodesForAgency(requestedCode);
          } else {
            managerCodes = [requestedCode];
          }
        } else if (roles.includes('mediator')) {
          managerCodes = [String((user as any)?.mediatorCode || '')];
        } else if (roles.includes('agency')) {
          managerCodes = await listMediatorCodesForAgency(String((user as any)?.mediatorCode || ''));
        } else {
          throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
        }

        managerCodes = managerCodes.filter(Boolean);
        if (!managerCodes.length) {
          res.json([]);
          return;
        }

        const orders = await OrderModel.find({
          managerName: { $in: managerCodes },
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();

        res.json(orders.map(toUiOrder));
      } catch (err) {
        next(err);
      }
    },

    getPendingUsers: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requested = typeof req.query.code === 'string' ? req.query.code : '';
        const code = isPrivileged(roles) ? requested : String((user as any)?.mediatorCode || '');
        if (!code) throw new AppError(400, 'INVALID_CODE', 'code required');

        const users = await UserModel.find({
          role: 'shopper',
          parentCode: code,
          isVerifiedByMediator: false,
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .lean();

        const wallets = await WalletModel.find({ ownerUserId: { $in: users.map((u) => u._id) } }).lean();
        res.json(mapUsersWithWallets(users, wallets));
      } catch (err) {
        next(err);
      }
    },

    getVerifiedUsers: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);
        const requested = typeof req.query.code === 'string' ? req.query.code : '';
        const code = isPrivileged(roles) ? requested : String((user as any)?.mediatorCode || '');
        if (!code) throw new AppError(400, 'INVALID_CODE', 'code required');

        const users = await UserModel.find({
          role: 'shopper',
          parentCode: code,
          isVerifiedByMediator: true,
          deletedAt: null,
        })
          .sort({ createdAt: -1 })
          .lean();

        const wallets = await WalletModel.find({ ownerUserId: { $in: users.map((u) => u._id) } }).lean();
        res.json(mapUsersWithWallets(users, wallets));
      } catch (err) {
        next(err);
      }
    },

    getLedger: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId, user } = getRequester(req);

        const payoutQuery: any = { deletedAt: null };

        if (!isPrivileged(roles)) {
          if (roles.includes('mediator')) {
            payoutQuery.beneficiaryUserId = userId;
          } else if (roles.includes('agency')) {
            const agencyCode = String((user as any)?.mediatorCode || '').trim();
            if (!agencyCode) {
              res.json([]);
              return;
            }
            const mediatorCodes = await listMediatorCodesForAgency(agencyCode);
            if (!mediatorCodes.length) {
              res.json([]);
              return;
            }
            const mediators = await UserModel.find({ roles: 'mediator', mediatorCode: { $in: mediatorCodes }, deletedAt: null })
              .select({ _id: 1 })
              .lean();
            payoutQuery.beneficiaryUserId = { $in: mediators.map((m) => m._id) };
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
          }
        }

        const payouts = await PayoutModel.find(payoutQuery).sort({ requestedAt: -1 }).limit(2000).lean();

        const users = await UserModel.find({ _id: { $in: payouts.map((p) => p.beneficiaryUserId) } })
          .select({ name: 1, mediatorCode: 1 })
          .lean();
        const byId = new Map(users.map((u) => [String(u._id), u]));

        res.json(
          payouts.map((p) => {
            const u = byId.get(String(p.beneficiaryUserId));
            return {
              id: String(p._id),
              mediatorName: u?.name ?? 'Mediator',
              mediatorCode: u?.mediatorCode,
              amount: Math.round((p.amountPaise ?? 0) / 100),
              date: (p.requestedAt ?? p.createdAt ?? new Date()).toISOString(),
              status: p.status === 'paid' ? 'Success' : String(p.status),
            };
          })
        );
      } catch (err) {
        next(err);
      }
    },

    approveMediator: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user: requester } = getRequester(req);
        const body = approveByIdSchema.parse(req.body);
        
        const mediator = await UserModel.findById(body.id).lean();
        if (!mediator || (mediator as any).deletedAt) {
          throw new AppError(404, 'USER_NOT_FOUND', 'Mediator not found');
        }

        // Allow admin/ops OR parent agency to approve
        const canApprove = 
          isPrivileged(roles) || 
          (roles.includes('agency') && String((mediator as any).parentCode) === String((requester as any)?.mediatorCode));

        if (!canApprove) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot approve mediators outside your network');
        }
        const user = await UserModel.findByIdAndUpdate(
          body.id,
          { kycStatus: 'verified', status: 'active' },
          { new: true }
        );
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'MEDIATOR_APPROVED', entityType: 'User', entityId: String(user._id) });

        // Realtime: update agency (who owns the mediator), admin/ops, and any UI that lists pending mediators.
        const agencyCode = String((mediator as any)?.parentCode || '').trim();
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { userId: String(user._id), kind: 'mediator', status: 'active', agencyCode },
          audience: {
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'mediator.approved', userId: String(user._id), agencyCode },
          audience: {
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    rejectMediator: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user: requester } = getRequester(req);
        const body = rejectByIdSchema.parse(req.body);

        const mediator = await UserModel.findById(body.id).lean();
        if (!mediator || (mediator as any).deletedAt) {
          throw new AppError(404, 'USER_NOT_FOUND', 'Mediator not found');
        }

        // Allow admin/ops OR parent agency to reject
        const canReject =
          isPrivileged(roles) ||
          (roles.includes('agency') && String((mediator as any).parentCode) === String((requester as any)?.mediatorCode));
        if (!canReject) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot reject mediators outside your network');
        }

        const user = await UserModel.findByIdAndUpdate(
          body.id,
          { kycStatus: 'rejected', status: 'suspended' },
          { new: true }
        );
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'MEDIATOR_REJECTED', entityType: 'User', entityId: String(user._id) });

        const agencyCode = String((mediator as any)?.parentCode || '').trim();
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { userId: String(user._id), kind: 'mediator', status: 'suspended', agencyCode },
          audience: {
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'mediator.rejected', userId: String(user._id), agencyCode },
          audience: {
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    approveUser: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = approveByIdSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);

        const buyerBefore = await UserModel.findById(body.id).select({ parentCode: 1, deletedAt: 1 }).lean();
        if (!buyerBefore || (buyerBefore as any).deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        const upstreamMediatorCode = String((buyerBefore as any).parentCode || '').trim();

        // Mediators can only approve their own buyers.
        if (roles.includes('mediator') && !isPrivileged(roles)) {
          if (String(upstreamMediatorCode) !== String((requester as any)?.mediatorCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Cannot approve users outside your network');
          }
        }

        const user = await UserModel.findByIdAndUpdate(body.id, { isVerifiedByMediator: true }, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'BUYER_APPROVED', entityType: 'User', entityId: String(user._id) });

        const agencyCode = upstreamMediatorCode ? (await getAgencyCodeForMediatorCode(upstreamMediatorCode)) || '' : '';
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { userId: String(user._id), kind: 'buyer', status: 'approved', mediatorCode: upstreamMediatorCode },
          audience: {
            userIds: [String(user._id)],
            ...(upstreamMediatorCode ? { mediatorCodes: [upstreamMediatorCode] } : {}),
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'buyer.approved', userId: String(user._id), mediatorCode: upstreamMediatorCode },
          audience: {
            ...(upstreamMediatorCode ? { mediatorCodes: [upstreamMediatorCode] } : {}),
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    rejectUser: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = rejectByIdSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);

        const buyerBefore = await UserModel.findById(body.id).select({ parentCode: 1, deletedAt: 1 }).lean();
        if (!buyerBefore || (buyerBefore as any).deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        const upstreamMediatorCode = String((buyerBefore as any).parentCode || '').trim();

        if (roles.includes('mediator') && !isPrivileged(roles)) {
          if (String(upstreamMediatorCode) !== String((requester as any)?.mediatorCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Cannot reject users outside your network');
          }
        }

        const user = await UserModel.findByIdAndUpdate(body.id, { status: 'suspended' }, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'USER_REJECTED', entityType: 'User', entityId: String(user._id) });

        const agencyCode = upstreamMediatorCode ? (await getAgencyCodeForMediatorCode(upstreamMediatorCode)) || '' : '';
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { userId: String(user._id), kind: 'buyer', status: 'rejected', mediatorCode: upstreamMediatorCode },
          audience: {
            userIds: [String(user._id)],
            ...(upstreamMediatorCode ? { mediatorCodes: [upstreamMediatorCode] } : {}),
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'buyer.rejected', userId: String(user._id), mediatorCode: upstreamMediatorCode },
          audience: {
            ...(upstreamMediatorCode ? { mediatorCodes: [upstreamMediatorCode] } : {}),
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    verifyOrderClaim: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = verifyOrderSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);
        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if ((order as any).frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        if (!isPrivileged(roles)) {
          if (roles.includes('mediator')) {
            if (String(order.managerName) !== String((requester as any)?.mediatorCode)) {
              throw new AppError(403, 'FORBIDDEN', 'Cannot verify orders outside your network');
            }
          } else if (roles.includes('agency')) {
            const allowed = await listMediatorCodesForAgency(String((requester as any)?.mediatorCode || ''));
            if (!allowed.includes(String(order.managerName))) {
              throw new AppError(403, 'FORBIDDEN', 'Cannot verify orders outside your network');
            }
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
          }
        }

        // Freeze verification if upstream is suspended.
        const managerCode = String(order.managerName || '');
        if (!(await isMediatorActive(managerCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Mediator is suspended; order is frozen');
        }
        const agencyCode = (await getAgencyCodeForMediatorCode(managerCode)) || '';
        if (agencyCode && !(await isAgencyActive(agencyCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Agency is suspended; order is frozen');
        }

        // Strict workflow: must be UNDER_REVIEW to approve.
        const wf = String((order as any).workflowStatus || 'CREATED');
        if (wf !== 'UNDER_REVIEW') {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot verify in state ${wf}`);
        }

        // Step 1: mark purchase proof verified (even if review/rating is still pending).
        (order as any).verification = (order as any).verification ?? {};
        (order as any).verification.order = (order as any).verification.order ?? {};
        (order as any).verification.order.verifiedAt = new Date();
        (order as any).verification.order.verifiedBy = req.auth?.userId;

        const required = getRequiredStepsForOrder(order);
        const missingProofs = required.filter((t) => !hasProofForRequirement(order, t));
        order.events = pushOrderEvent(order.events as any, {
          type: 'VERIFIED',
          at: new Date(),
          actorUserId: req.auth?.userId,
          metadata: { step: 'order', missingProofs },
        }) as any;
        await order.save();

        // Only finalize approval when *all* required steps are present and verified.
        const finalize = await finalizeApprovalIfReady(order, String(req.auth?.userId || ''));

        await writeAuditLog({ req, action: 'ORDER_VERIFIED', entityType: 'Order', entityId: String(order._id) });

        const audience = buildOrderAudience(order, agencyCode);
        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        res.json({ ok: true, approved: (finalize as any).approved, ...(finalize as any) });
      } catch (err) {
        next(err);
      }
    },

    verifyOrderRequirement: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = verifyOrderRequirementSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);

        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if ((order as any).frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        if (!isPrivileged(roles)) {
          if (roles.includes('mediator')) {
            if (String(order.managerName) !== String((requester as any)?.mediatorCode)) {
              throw new AppError(403, 'FORBIDDEN', 'Cannot verify orders outside your network');
            }
          } else if (roles.includes('agency')) {
            const allowed = await listMediatorCodesForAgency(String((requester as any)?.mediatorCode || ''));
            if (!allowed.includes(String(order.managerName))) {
              throw new AppError(403, 'FORBIDDEN', 'Cannot verify orders outside your network');
            }
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
          }
        }

        // Freeze verification if upstream is suspended.
        const managerCode = String(order.managerName || '');
        if (!(await isMediatorActive(managerCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Mediator is suspended; order is frozen');
        }
        const agencyCode = (await getAgencyCodeForMediatorCode(managerCode)) || '';
        if (agencyCode && !(await isAgencyActive(agencyCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Agency is suspended; order is frozen');
        }

        const wf = String((order as any).workflowStatus || 'CREATED');
        if (wf !== 'UNDER_REVIEW') {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot verify in state ${wf}`);
        }

        if (!order.verification?.order?.verifiedAt) {
          throw new AppError(409, 'PURCHASE_NOT_VERIFIED', 'Purchase proof must be verified first');
        }

        const required = getRequiredStepsForOrder(order);
        if (!required.includes(body.type)) {
          throw new AppError(409, 'NOT_REQUIRED', `This order does not require ${body.type} verification`);
        }

        if (!hasProofForRequirement(order, body.type)) {
          throw new AppError(409, 'MISSING_PROOF', `Missing ${body.type} proof`);
        }

        (order as any).verification = (order as any).verification ?? {};
        (order as any).verification[body.type] = (order as any).verification[body.type] ?? {};
        (order as any).verification[body.type].verifiedAt = new Date();
        (order as any).verification[body.type].verifiedBy = req.auth?.userId;

        order.events = pushOrderEvent(order.events as any, {
          type: 'VERIFIED',
          at: new Date(),
          actorUserId: req.auth?.userId,
          metadata: { step: body.type },
        }) as any;
        await order.save();

        const finalize = await finalizeApprovalIfReady(order, String(req.auth?.userId || ''));
        await writeAuditLog({ req, action: 'ORDER_VERIFIED', entityType: 'Order', entityId: String(order._id) });

        const audience = buildOrderAudience(order, agencyCode);
        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        res.json({ ok: true, approved: (finalize as any).approved, ...(finalize as any) });
      } catch (err) {
        next(err);
      }
    },

    settleOrderPayment: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = settleOrderSchema.parse(req.body);
        const { roles, user } = getRequester(req);
        const settlementMode = (body as any).settlementMode === 'external' ? 'external' : 'wallet';

        // Privileged: may settle any order.
        // Non-privileged: may settle only within their scope.
        const requesterMediatorCode = String((user as any)?.mediatorCode || '').trim();
        const canSettleAny = isPrivileged(roles);
        const canSettleScoped = roles.includes('mediator') || roles.includes('agency');
        if (!canSettleAny && !canSettleScoped) {
          throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
        }

        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if (!canSettleAny) {
          const orderManagerCode = String(order.managerName || '').trim();
          if (!orderManagerCode) throw new AppError(409, 'INVALID_ORDER', 'Order is missing manager code');

          if (roles.includes('mediator')) {
            if (!requesterMediatorCode || requesterMediatorCode !== orderManagerCode) {
              throw new AppError(403, 'FORBIDDEN', 'You can only settle your own orders');
            }
          }

          if (roles.includes('agency')) {
            if (!requesterMediatorCode) {
              throw new AppError(403, 'FORBIDDEN', 'Agency is missing code');
            }
            const allowedCodes = await listMediatorCodesForAgency(requesterMediatorCode);
            if (!allowedCodes.includes(orderManagerCode)) {
              throw new AppError(403, 'FORBIDDEN', 'You can only settle orders within your agency');
            }
          }
        }
        if ((order as any).frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        const managerCode = String(order.managerName || '');
        if (!(await isMediatorActive(managerCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Mediator is suspended; payouts are blocked');
        }
        const agencyCode = (await getAgencyCodeForMediatorCode(managerCode)) || '';
        if (agencyCode && !(await isAgencyActive(agencyCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Agency is suspended; payouts are blocked');
        }

        const hasOpenDispute = await TicketModel.exists({
          orderId: String(order._id),
          status: 'Open',
          deletedAt: null,
        });
        if (hasOpenDispute) {
          order.affiliateStatus = 'Frozen_Disputed';
          await order.save();
          throw new AppError(409, 'FROZEN_DISPUTE', 'This transaction is frozen due to an open ticket.');
        }

        const wf = String((order as any).workflowStatus || 'CREATED');
        if (wf !== 'APPROVED') {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot settle in state ${wf}`);
        }

        const campaignId = order.items?.[0]?.campaignId;
        const productId = String(order.items?.[0]?.productId || '').trim();
        const mediatorCode = String(order.managerName || '').trim();

        const campaign = campaignId ? await CampaignModel.findById(campaignId).lean() : null;

        let isOverLimit = false;
        if (campaignId && mediatorCode) {
          if (campaign) {
            const assignmentsObj = campaign.assignments instanceof Map
              ? Object.fromEntries(campaign.assignments)
              : (campaign.assignments as any);
            const rawAssigned = assignmentsObj?.[mediatorCode];
            const assignedLimit =
              typeof rawAssigned === 'number' ? rawAssigned : Number(rawAssigned?.limit ?? 0);

            if (assignedLimit > 0) {
              const settledCount = await OrderModel.countDocuments({
                managerName: mediatorCode,
                'items.0.campaignId': campaignId,
                $or: [{ affiliateStatus: 'Approved_Settled' }, { paymentStatus: 'Paid' }],
                _id: { $ne: order._id },
                deletedAt: null,
              });
              if (settledCount >= assignedLimit) isOverLimit = true;
            }
          }
        }

        // Money movements (wallet mode only): enforce conservation on successful settlements.
        // - Debit brand wallet by the Deal payout
        // - Credit buyer commission and mediator margin (payout - commission)
        // Idempotency keys prevent double-moves on retries.
        if (!isOverLimit && settlementMode === 'wallet') {
          if (!productId) {
            throw new AppError(409, 'MISSING_DEAL_ID', 'Order is missing deal reference');
          }

          const deal = await DealModel.findById(productId).lean();
          if (!deal || (deal as any).deletedAt) {
            throw new AppError(409, 'DEAL_NOT_FOUND', 'Cannot settle: deal not found');
          }

          const payoutPaise = Number((deal as any).payoutPaise ?? 0);
          const buyerCommissionPaise = Number(order.items?.[0]?.commissionPaise ?? 0);
          if (payoutPaise <= 0) {
            throw new AppError(409, 'INVALID_PAYOUT', 'Cannot settle: deal payout is invalid');
          }
          if (buyerCommissionPaise < 0) {
            throw new AppError(409, 'INVALID_COMMISSION', 'Cannot settle: commission is invalid');
          }
          if (buyerCommissionPaise > payoutPaise) {
            throw new AppError(409, 'INVALID_ECONOMICS', 'Cannot settle: commission exceeds payout');
          }

          const buyerUserId = String(order.createdBy);
          const brandId = String((order as any).brandUserId || (campaign as any)?.brandUserId || '').trim();
          if (!brandId) {
            throw new AppError(409, 'MISSING_BRAND', 'Cannot settle: missing brand ownership');
          }

          await ensureWallet(brandId);

          await applyWalletDebit({
            idempotencyKey: `order-settlement-debit-${order._id}`,
            type: 'order_settlement_debit',
            ownerUserId: brandId,
            fromUserId: brandId,
            toUserId: buyerUserId,
            amountPaise: payoutPaise,
            orderId: String(order._id),
            campaignId: campaignId ? String(campaignId) : undefined,
            metadata: { reason: 'ORDER_PAYOUT', dealId: productId, mediatorCode },
          });

          // Credit buyer commission.
          if (buyerCommissionPaise > 0) {
            await ensureWallet(buyerUserId);
            await applyWalletCredit({
              idempotencyKey: `order-commission-${order._id}`,
              type: 'commission_settle',
              ownerUserId: buyerUserId,
              amountPaise: buyerCommissionPaise,
              orderId: String(order._id),
              campaignId: campaignId ? String(campaignId) : undefined,
              metadata: { reason: 'ORDER_COMMISSION', dealId: productId },
            });
          }

          // Credit mediator margin (payout - commission).
          const mediatorMarginPaise = payoutPaise - buyerCommissionPaise;
          if (mediatorMarginPaise > 0 && mediatorCode) {
            const mediator = await UserModel.findOne({ mediatorCode }).lean();
            if (mediator && !(mediator as any).deletedAt) {
              const mediatorUserId = String((mediator as any)._id);
              await ensureWallet(mediatorUserId);
              await applyWalletCredit({
                idempotencyKey: `order-margin-${order._id}`,
                type: 'commission_settle',
                ownerUserId: mediatorUserId,
                amountPaise: mediatorMarginPaise,
                orderId: String(order._id),
                campaignId: campaignId ? String(campaignId) : undefined,
                metadata: { reason: 'ORDER_MARGIN', dealId: productId, mediatorCode },
              });
            }
          }
        }
        order.paymentStatus = 'Paid';
        order.affiliateStatus = isOverLimit ? 'Cap_Exceeded' : 'Approved_Settled';
        (order as any).settlementMode = settlementMode;
        if (body.settlementRef) {
          (order as any).settlementRef = body.settlementRef;
        }
        order.events = pushOrderEvent(order.events as any, {
          type: isOverLimit ? 'CAP_EXCEEDED' : 'SETTLED',
          at: new Date(),
          actorUserId: req.auth?.userId,
          metadata: {
            ...(body.settlementRef ? { settlementRef: body.settlementRef } : {}),
            settlementMode,
          },
        }) as any;
        await order.save();

        // Strict workflow:
        // APPROVED -> REWARD_PENDING -> COMPLETED/FAILED
        await transitionOrderWorkflow({
          orderId: String(order._id),
          from: 'APPROVED',
          to: 'REWARD_PENDING',
          actorUserId: String(req.auth?.userId || ''),
          metadata: { source: 'settleOrderPayment' },
        });

        await transitionOrderWorkflow({
          orderId: String(order._id),
          from: 'REWARD_PENDING',
          to: isOverLimit ? 'FAILED' : 'COMPLETED',
          actorUserId: String(req.auth?.userId || ''),
          metadata: { affiliateStatus: order.affiliateStatus },
        });

        await writeAuditLog({ req, action: 'ORDER_SETTLED', entityType: 'Order', entityId: String(order._id), metadata: { affiliateStatus: order.affiliateStatus } });

        const audience = buildOrderAudience(order, agencyCode);
        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        if (settlementMode === 'wallet') {
          publishRealtime({ type: 'wallets.changed', ts: new Date().toISOString(), audience });
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    unsettleOrderPayment: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = unsettleOrderSchema.parse(req.body);
        const { roles, user } = getRequester(req);

        // Same permission model as settlement: privileged can revert anything,
        // non-privileged can revert only within their scope.
        const requesterCode = String((user as any)?.mediatorCode || '').trim();
        const canAny = isPrivileged(roles);
        const canScoped = roles.includes('mediator') || roles.includes('agency');
        if (!canAny && !canScoped) throw new AppError(403, 'FORBIDDEN', 'Insufficient role');

        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

        if ((order as any).frozen) {
          throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
        }

        if (!canAny) {
          const orderManagerCode = String(order.managerName || '').trim();
          if (!orderManagerCode) throw new AppError(409, 'INVALID_ORDER', 'Order is missing manager code');

          if (roles.includes('mediator')) {
            if (!requesterCode || requesterCode !== orderManagerCode) {
              throw new AppError(403, 'FORBIDDEN', 'You can only revert your own orders');
            }
          }

          if (roles.includes('agency')) {
            if (!requesterCode) throw new AppError(403, 'FORBIDDEN', 'Agency is missing code');
            const allowed = await listMediatorCodesForAgency(requesterCode);
            if (!allowed.includes(orderManagerCode)) {
              throw new AppError(403, 'FORBIDDEN', 'You can only revert orders within your agency');
            }
          }
        }

        const wf = String((order as any).workflowStatus || 'CREATED');
        if (!['COMPLETED', 'FAILED', 'REWARD_PENDING'].includes(wf)) {
          throw new AppError(409, 'INVALID_WORKFLOW_STATE', `Cannot revert settlement in state ${wf}`);
        }

        const prevAffiliateStatus = String(order.affiliateStatus || '');

        if (String(order.paymentStatus) !== 'Paid') {
          throw new AppError(409, 'NOT_SETTLED', 'Order is not settled');
        }

        // Reverse money movements if this was a wallet settlement.
        // If CAP_EXCEEDED path was used, no money movement occurred; reversal is a no-op.
        // If settlementMode=external, reversal is a no-op.
        const productId = String(order.items?.[0]?.productId || '').trim();
        const campaignId = order.items?.[0]?.campaignId;
        const mediatorCode = String(order.managerName || '').trim();

        const campaign = campaignId ? await CampaignModel.findById(campaignId).lean() : null;
        const brandId = String((order as any).brandUserId || (campaign as any)?.brandUserId || '').trim();

        const isCapExceeded = String(order.affiliateStatus) === 'Cap_Exceeded';
        const settlementMode = String((order as any).settlementMode || 'wallet');

        if (!isCapExceeded && settlementMode !== 'external') {
          if (!productId) throw new AppError(409, 'MISSING_DEAL_ID', 'Order is missing deal reference');
          const deal = await DealModel.findById(productId).lean();
          if (!deal || (deal as any).deletedAt) throw new AppError(409, 'DEAL_NOT_FOUND', 'Cannot revert: deal not found');

          const payoutPaise = Number((deal as any).payoutPaise ?? 0);
          const buyerCommissionPaise = Number(order.items?.[0]?.commissionPaise ?? 0);
          const mediatorMarginPaise = payoutPaise - buyerCommissionPaise;

          const buyerUserId = String(order.createdBy);
          if (!brandId) throw new AppError(409, 'MISSING_BRAND', 'Cannot revert: missing brand ownership');

          // Credit brand back first.
          await ensureWallet(brandId);
          await applyWalletCredit({
            idempotencyKey: `order-unsettle-credit-brand-${order._id}`,
            type: 'refund',
            ownerUserId: brandId,
            fromUserId: buyerUserId,
            toUserId: brandId,
            amountPaise: payoutPaise,
            orderId: String(order._id),
            campaignId: campaignId ? String(campaignId) : undefined,
            metadata: { reason: 'ORDER_UNSETTLE', dealId: productId, mediatorCode },
          });

          // Then debit buyer commission back.
          if (buyerCommissionPaise > 0) {
            try {
              await applyWalletDebit({
                idempotencyKey: `order-unsettle-debit-buyer-${order._id}`,
                type: 'order_settlement_debit',
                ownerUserId: buyerUserId,
                fromUserId: buyerUserId,
                toUserId: brandId,
                amountPaise: buyerCommissionPaise,
                orderId: String(order._id),
                campaignId: campaignId ? String(campaignId) : undefined,
                metadata: { reason: 'ORDER_UNSETTLE_COMMISSION', dealId: productId },
              });
            } catch (e: any) {
              const code = (e as any)?.code;
              if (code === 'INSUFFICIENT_FUNDS') {
                throw new AppError(
                  409,
                  'INSUFFICIENT_FUNDS_FOR_REVERSAL',
                  'Cannot revert: buyer has insufficient balance to reverse commission'
                );
              }
              throw e;
            }
          }

          // Then debit mediator margin back.
          if (mediatorMarginPaise > 0 && mediatorCode) {
            const mediator = await UserModel.findOne({ mediatorCode }).lean();
            if (mediator && !(mediator as any).deletedAt) {
              const mediatorUserId = String((mediator as any)._id);
              try {
                await applyWalletDebit({
                  idempotencyKey: `order-unsettle-debit-mediator-${order._id}`,
                  type: 'order_settlement_debit',
                  ownerUserId: mediatorUserId,
                  fromUserId: mediatorUserId,
                  toUserId: brandId,
                  amountPaise: mediatorMarginPaise,
                  orderId: String(order._id),
                  campaignId: campaignId ? String(campaignId) : undefined,
                  metadata: { reason: 'ORDER_UNSETTLE_MARGIN', dealId: productId, mediatorCode },
                });
              } catch (e: any) {
                const code = (e as any)?.code;
                if (code === 'INSUFFICIENT_FUNDS') {
                  throw new AppError(
                    409,
                    'INSUFFICIENT_FUNDS_FOR_REVERSAL',
                    'Cannot revert: mediator has insufficient balance to reverse margin'
                  );
                }
                throw e;
              }
            }
          }
        }

        // Force-reset workflow back to APPROVED so it can be settled again.
        // This is an administrative correction path and is always event-logged.
        (order as any).workflowStatus = 'APPROVED';
        order.paymentStatus = 'Pending';
        order.affiliateStatus = 'Pending_Cooling';
        (order as any).settlementRef = undefined;
        (order as any).settlementMode = 'wallet';

        order.events = pushOrderEvent(order.events as any, {
          type: 'STATUS_CHANGED',
          at: new Date(),
          actorUserId: req.auth?.userId,
          metadata: {
            reason: 'UNSETTLE',
            paymentStatus: { from: 'Paid', to: 'Pending' },
            affiliateStatus: { from: prevAffiliateStatus, to: 'Pending_Cooling' },
          },
        }) as any;

        order.events = pushOrderEvent(order.events as any, {
          type: 'WORKFLOW_TRANSITION',
          at: new Date(),
          actorUserId: req.auth?.userId,
          metadata: { from: wf, to: 'APPROVED', forced: true, source: 'unsettleOrderPayment' },
        }) as any;

        await order.save();

        await writeAuditLog({
          req,
          action: 'ORDER_UNSETTLED',
          entityType: 'Order',
          entityId: String(order._id),
          metadata: { previousWorkflow: wf, previousAffiliateStatus: prevAffiliateStatus },
        });

        const managerCode = String(order.managerName || '').trim();
        const agencyCode = managerCode ? ((await getAgencyCodeForMediatorCode(managerCode)) || '') : '';
        const audience = buildOrderAudience(order, agencyCode);
        publishRealtime({ type: 'orders.changed', ts: new Date().toISOString(), audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        if (settlementMode !== 'external') {
          publishRealtime({ type: 'wallets.changed', ts: new Date().toISOString(), audience });
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    createCampaign: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createCampaignSchema.parse(req.body);
        const { roles, userId, user: requester } = getRequester(req);

        const allowed = Array.isArray(body.allowedAgencies) ? body.allowedAgencies : [];

        // Privileged: create campaigns on behalf of a brand.
        if (isPrivileged(roles)) {
          const brandUserId = String(body.brandUserId || '').trim();
          if (!brandUserId) throw new AppError(400, 'MISSING_BRAND_USER_ID', 'brandUserId is required');

          const brand = await UserModel.findById(brandUserId).lean();
          if (!brand || (brand as any).deletedAt) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
          if (!((brand as any).roles || []).includes('brand')) throw new AppError(400, 'INVALID_BRAND', 'Invalid brand');
          if ((brand as any).status !== 'active') throw new AppError(409, 'BRAND_SUSPENDED', 'Brand is not active');

          const connected = Array.isArray((brand as any).connectedAgencies) ? (brand as any).connectedAgencies : [];
          if (allowed.length && !allowed.every((c) => connected.includes(String(c)))) {
            throw new AppError(400, 'INVALID_ALLOWED_AGENCIES', 'allowedAgencies must be connected to brand');
          }

          const campaign = await CampaignModel.create({
            title: body.title,
            brandUserId: (brand as any)._id,
            brandName: String((brand as any).name || 'Brand'),
            platform: body.platform,
            image: body.image,
            productUrl: body.productUrl,
            originalPricePaise: rupeesToPaise(body.originalPrice),
            pricePaise: rupeesToPaise(body.price),
            payoutPaise: rupeesToPaise(body.payout),
            totalSlots: body.totalSlots,
            usedSlots: 0,
            status: 'active',
            allowedAgencyCodes: allowed,
            dealType: body.dealType,
            returnWindowDays: body.returnWindowDays ?? 14,
            createdBy: req.auth?.userId as any,
          });

          await writeAuditLog({ req, action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: String((campaign as any)._id) });
          const ts = new Date().toISOString();
          publishRealtime({
            type: 'deals.changed',
            ts,
            payload: { campaignId: String((campaign as any)._id) },
            audience: {
              userIds: [String((brand as any)._id)],
              agencyCodes: allowed.map((c) => String(c).trim()).filter(Boolean),
              roles: ['admin', 'ops'],
            },
          });
          res.status(201).json(toUiCampaign((campaign as any).toObject ? (campaign as any).toObject() : (campaign as any)));
          return;
        }

        // Non-privileged (agency/mediator): allow creating self-owned inventory campaigns.
        if (!roles.includes('agency') && !roles.includes('mediator')) {
          throw new AppError(403, 'FORBIDDEN', 'Only agency/mediator can create campaigns via ops endpoint');
        }

        const selfCode = String((requester as any)?.mediatorCode || '').trim();
        if (!selfCode) throw new AppError(409, 'MISSING_CODE', 'User is missing a code');
        if (!allowed.length) throw new AppError(400, 'INVALID_ALLOWED_AGENCIES', 'allowedAgencies is required');
        const normalizedAllowed = allowed.map((c) => String(c).trim()).filter(Boolean);
        const onlySelf = normalizedAllowed.length === 1 && normalizedAllowed[0] === selfCode;
        if (!onlySelf) {
          throw new AppError(403, 'FORBIDDEN', 'Non-privileged users can only create campaigns for their own code');
        }

        const campaign = await CampaignModel.create({
          title: body.title,
          brandUserId: userId as any,
          brandName: String((requester as any).name || 'Inventory'),
          platform: body.platform,
          image: body.image,
          productUrl: body.productUrl,
          originalPricePaise: rupeesToPaise(body.originalPrice),
          pricePaise: rupeesToPaise(body.price),
          payoutPaise: rupeesToPaise(body.payout),
          totalSlots: body.totalSlots,
          usedSlots: 0,
          status: 'active',
          allowedAgencyCodes: normalizedAllowed,
          dealType: body.dealType,
          returnWindowDays: body.returnWindowDays ?? 14,
          createdBy: req.auth?.userId as any,
        });

        await writeAuditLog({ req, action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: String((campaign as any)._id) });
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'deals.changed',
          ts,
          payload: { campaignId: String((campaign as any)._id) },
          audience: {
            // Cover both agency-owned and mediator-owned inventory campaigns.
            agencyCodes: normalizedAllowed,
            mediatorCodes: normalizedAllowed,
            roles: ['admin', 'ops'],
          },
        });
        res.status(201).json(toUiCampaign((campaign as any).toObject ? (campaign as any).toObject() : (campaign as any)));
      } catch (err) {
        next(err);
      }
    },

    assignSlots: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = assignSlotsSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);
        const campaign = await CampaignModel.findById(body.id);
        if (!campaign || campaign.deletedAt) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        // Campaign terms become immutable after the first real slot assignment.
        // Allow reassigning limits, but disallow changing economics once locked.
        if ((campaign as any).locked) {
          const attemptingTermChange =
            typeof (body as any).dealType !== 'undefined' ||
            typeof (body as any).price !== 'undefined' ||
            typeof (body as any).payout !== 'undefined';
          if (attemptingTermChange) {
            throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is locked after slot assignment; create a new campaign to change terms');
          }
        }

        const hasOrders = await OrderModel.exists({ 'items.campaignId': campaign._id, deletedAt: null });
        if (hasOrders) {
          throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is locked after first order; create a new campaign to change terms');
        }

        // Agency can only assign slots for campaigns explicitly allowed for that agency.
        const agencyCode = roles.includes('agency') && !isPrivileged(roles)
          ? String((requester as any)?.mediatorCode || '').trim()
          : '';

        if (agencyCode) {
          const allowed = Array.isArray(campaign.allowedAgencyCodes) ? campaign.allowedAgencyCodes : [];
          if (!allowed.includes(agencyCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Campaign not assigned to this agency');
          }
        }

        // Filter down to only meaningful assignments (limit > 0).
        const positiveEntries = Object.entries(body.assignments || {}).filter(([, assignment]) => {
          if (typeof assignment === 'number') return assignment > 0;
          const limit = Number((assignment as any)?.limit ?? 0);
          return Number.isFinite(limit) && limit > 0;
        });
        if (positiveEntries.length === 0) {
          throw new AppError(400, 'NO_ASSIGNMENTS', 'At least one allocation (limit > 0) is required');
        }

        // Security: agency can only assign to active mediators under its own code.
        if (agencyCode) {
          const assignmentCodes = positiveEntries.map(([code]) => String(code).trim()).filter(Boolean);
          const mediators = await UserModel.find({
            roles: 'mediator',
            mediatorCode: { $in: assignmentCodes },
            parentCode: agencyCode,
            status: 'active',
            deletedAt: null,
          })
            .select({ mediatorCode: 1 })
            .lean();
          const allowedCodes = new Set(mediators.map((m: any) => String(m.mediatorCode || '').trim()).filter(Boolean));
          const invalid = assignmentCodes.filter((c) => !allowedCodes.has(String(c).trim()));
          if (invalid.length) {
            throw new AppError(403, 'INVALID_MEDIATOR_CODE', 'One or more mediators are not active or not in your team');
          }
        }

        // NEW SCHEMA: assignments is Map<string, { limit: number, payout?: number }>
        const current = campaign.assignments instanceof Map ? campaign.assignments : new Map();
        for (const [code, assignment] of positiveEntries) {
          // Support both old format (number) and new format ({ limit, payout })
          const assignmentObj = typeof assignment === 'number'
            ? { limit: assignment, payout: campaign.payoutPaise }
            : {
                limit: (assignment as any).limit,
                // API payloads use rupees like the rest of ops endpoints; store payout in paise.
                payout:
                  typeof (assignment as any).payout === 'number'
                    ? rupeesToPaise((assignment as any).payout)
                    : campaign.payoutPaise,
              };
          current.set(code, assignmentObj as any);
        }
        campaign.assignments = current as any;

        if (body.dealType) campaign.dealType = body.dealType as any;
        if (typeof body.price !== 'undefined') campaign.pricePaise = rupeesToPaise(body.price);
        if (typeof body.payout !== 'undefined') campaign.payoutPaise = rupeesToPaise(body.payout);

        // Once we have at least one real assignment, lock the campaign terms.
        if (!(campaign as any).locked) {
          (campaign as any).locked = true;
          (campaign as any).lockedAt = new Date();
          (campaign as any).lockedReason = 'SLOT_ASSIGNMENT';
        }

        await campaign.save();
        await writeAuditLog({ req, action: 'CAMPAIGN_SLOTS_ASSIGNED', entityType: 'Campaign', entityId: String(campaign._id) });

        const assignmentCodes = positiveEntries.map(([c]) => String(c).trim()).filter(Boolean);
        const inferredAgencyCodes = (
          await Promise.all(assignmentCodes.map((c) => getAgencyCodeForMediatorCode(c)))
        ).filter((c): c is string => typeof c === 'string' && !!c);

        const agencyCodes = Array.from(
          new Set([
            ...((campaign as any).allowedAgencyCodes ?? []).map((c: any) => String(c).trim()).filter(Boolean),
            ...assignmentCodes,
            ...inferredAgencyCodes,
          ])
        ).filter(Boolean);

        const ts = new Date().toISOString();
        publishRealtime({
          type: 'deals.changed',
          ts,
          payload: { campaignId: String(campaign._id) },
          audience: {
            userIds: [String((campaign as any).brandUserId || '')].filter(Boolean),
            agencyCodes,
            mediatorCodes: assignmentCodes,
            roles: ['admin', 'ops'],
          },
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    publishDeal: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = publishDealSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);
        const campaign = await CampaignModel.findById(body.id).lean();
        if (!campaign || campaign.deletedAt) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        if (!isPrivileged(roles)) {
          if (!roles.includes('mediator')) throw new AppError(403, 'FORBIDDEN', 'Only mediators can publish deals');
          const selfCode = String((requester as any)?.mediatorCode || '').trim();
          if (!selfCode || selfCode !== body.mediatorCode) {
            throw new AppError(403, 'FORBIDDEN', 'Cannot publish deals for other mediators');
          }

          // Ensure mediator belongs to an allowed agency for this campaign.
          // Note: `allowedAgencyCodes` historically contains either an agency code (agency-owned campaigns)
          // OR a mediator code (mediator self-owned inventory). Accept either for the publishing mediator.
          const agencyCode = String((requester as any)?.parentCode || '').trim();
          const allowedCodesRaw = Array.isArray((campaign as any).allowedAgencyCodes) ? (campaign as any).allowedAgencyCodes : [];
          const allowedCodes = new Set(allowedCodesRaw.map((c: any) => String(c).trim()).filter(Boolean));

          const isAllowed = (agencyCode && allowedCodes.has(agencyCode)) || allowedCodes.has(selfCode);
          if (!isAllowed) {
            throw new AppError(403, 'FORBIDDEN', 'Campaign not assigned to your network');
          }
        }

        const commissionPaise = rupeesToPaise(body.commission);
        const pricePaise = Number(campaign.pricePaise ?? 0) + commissionPaise;

        // CRITICAL: Get mediator's payout from campaign.assignments
        const assignmentsObj = campaign.assignments instanceof Map ? Object.fromEntries(campaign.assignments) : (campaign.assignments as any);
        const slotAssignment = assignmentsObj?.[body.mediatorCode];
        const payoutPaise = slotAssignment?.payout ?? campaign.payoutPaise;

        // ANTI-FRAUD: Commission cannot exceed payout (mediator would lose money)
        if (commissionPaise > payoutPaise) {
          throw new AppError(400, 'INVALID_COMMISSION', 'Commission cannot exceed payout');
        }

        // CRITICAL: Check if deal already published to prevent re-publishing with different terms
        const existingDeal = await DealModel.findOne({ 
          campaignId: campaign._id, 
          mediatorCode: body.mediatorCode, 
          deletedAt: null 
        }).lean();

        if (existingDeal) {
          // Allow updating commission/active status only, not structural changes
          await DealModel.findOneAndUpdate(
            { _id: (existingDeal as any)._id },
            {
              $set: {
                commissionPaise,
                pricePaise,
                payoutPaise,
                active: true,
              },
            }
          );
        } else {
          // First-time deal creation
          await DealModel.create({
            campaignId: campaign._id,
            mediatorCode: body.mediatorCode,
            title: campaign.title,
            image: campaign.image,
            productUrl: campaign.productUrl,
            platform: campaign.platform,
            brandName: campaign.brandName,
            dealType: (campaign as any).dealType ?? 'Discount',
            originalPricePaise: campaign.originalPricePaise,
            pricePaise,
            commissionPaise,
            payoutPaise,
            active: true,
            createdBy: req.auth?.userId as any,
          });
        }

        await writeAuditLog({ req, action: 'DEAL_PUBLISHED', entityType: 'Deal', entityId: `${String(campaign._id)}:${body.mediatorCode}`, metadata: { campaignId: String(campaign._id), mediatorCode: body.mediatorCode } });

        const agencyCode = (await getAgencyCodeForMediatorCode(body.mediatorCode)) || '';
        publishRealtime({
          type: 'deals.changed',
          ts: new Date().toISOString(),
          payload: { campaignId: String(campaign._id), mediatorCode: body.mediatorCode },
          audience: {
            roles: ['admin', 'ops'],
            mediatorCodes: [body.mediatorCode],
            parentCodes: [body.mediatorCode],
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
          },
        });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    payoutMediator: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = payoutMediatorSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);
        const canAny = isPrivileged(roles);
        const canAgency = roles.includes('agency') && !canAny;
        if (!canAny && !canAgency) {
          throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
        }

        if (canAgency) {
          const agencyCode = String((requester as any)?.mediatorCode || '').trim();
          if (!agencyCode) throw new AppError(409, 'MISSING_CODE', 'Agency is missing code');
          if (!(await isAgencyActive(agencyCode))) {
            throw new AppError(409, 'FROZEN_SUSPENSION', 'Agency is not active; payouts are blocked');
          }
        }
        const user = await UserModel.findById(body.mediatorId);
        if (!user || user.deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        if (canAgency) {
          const agencyCode = String((requester as any)?.mediatorCode || '').trim();
          const isMediator = Array.isArray((user as any).roles) ? (user as any).roles.includes('mediator') : (user as any).roles === 'mediator';
          if (!isMediator) throw new AppError(409, 'INVALID_BENEFICIARY', 'Beneficiary must be a mediator');
          const parentCode = String((user as any).parentCode || '').trim();
          if (!parentCode || parentCode !== agencyCode) {
            throw new AppError(403, 'FORBIDDEN', 'You can only payout mediators within your agency');
          }
        }
        if (user.status !== 'active') {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Beneficiary is not active; payouts are blocked');
        }

        const agencyCode = String((user as any).parentCode || '').trim();
        if (agencyCode && !(await isAgencyActive(agencyCode))) {
          throw new AppError(409, 'FROZEN_SUSPENSION', 'Upstream agency is not active; payouts are blocked');
        }

        const wallet = await ensureWallet(String(user._id));
        const amountPaise = rupeesToPaise(body.amount);

        const payout = await PayoutModel.create({
          beneficiaryUserId: user._id,
          walletId: wallet._id,
          amountPaise,
          status: 'paid',
          provider: 'manual',
          providerRef: `MANUAL-${Date.now()}`,
          processedAt: new Date(),
          requestedAt: new Date(),
          createdBy: req.auth?.userId,
          updatedBy: req.auth?.userId,
        });

        // Agencies use this flow as a record of an external/manual transfer.
        // Do not block on internal wallet balance (agencies may reconcile off-platform).
        // Privileged users keep the strict wallet-debit behavior.
        if (canAny) {
          await applyWalletDebit({
            idempotencyKey: `payout_complete:${payout._id}`,
            type: 'payout_complete',
            ownerUserId: String(user._id),
            amountPaise,
            payoutId: payout._id as any,
            metadata: { provider: 'manual', source: 'ops_payout' },
          });
        }

        await writeAuditLog({ req, action: 'PAYOUT_PROCESSED', entityType: 'Payout', entityId: String(payout._id), metadata: { beneficiaryUserId: String(user._id), amountPaise, recordOnly: canAgency } });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    // Optional endpoint used by some UI versions.
    getTransactions: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const tx = await TransactionModel.find({ deletedAt: null })
          .sort({ createdAt: -1 })
          .limit(1000)
          .lean();
        res.json(tx);
      } catch (err) {
        next(err);
      }
    },
  };
}
