import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
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
  verifyOrderSchema,
} from '../validations/ops.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiCampaign, toUiOrder, toUiUser } from '../utils/uiMappers.js';
import { ensureWallet, applyWalletDebit, applyWalletCredit } from '../services/walletService.js';
import { getRequester, isPrivileged, requireAnyRole } from '../services/authz.js';
import { listMediatorCodesForAgency, getAgencyCodeForMediatorCode, isAgencyActive, isMediatorActive } from '../services/lineage.js';
import { pushOrderEvent } from '../services/orderEvents.js';
import { writeAuditLog } from '../services/audit.js';
import { requestBrandConnectionSchema } from '../validations/connections.js';
import { transitionOrderWorkflow } from '../services/orderWorkflow.js';

function mapUsersWithWallets(users: any[], wallets: any[]) {
  const byUserId = new Map<string, any>();
  for (const w of wallets) byUserId.set(String(w.ownerUserId), w);
  return users.map((u) => toUiUser(u, byUserId.get(String(u._id))));
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

        const brand = await UserModel.findOne({ brandCode: body.brandCode, roles: 'brand', deletedAt: { $exists: false } });
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
          deletedAt: { $exists: false },
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

        const query: any = { deletedAt: { $exists: false } };
        if (code) {
          query.$or = [
            { allowedAgencyCodes: code },
            { [`assignments.${code}`]: { $exists: true } },
          ];
        }

        const campaigns = await CampaignModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        res.json(campaigns.map(toUiCampaign));
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
          deletedAt: { $exists: false },
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
          deletedAt: { $exists: false },
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
          deletedAt: { $exists: false },
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

        const payoutQuery: any = { deletedAt: { $exists: false } };

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
            const mediators = await UserModel.find({ roles: 'mediator', mediatorCode: { $in: mediatorCodes }, deletedAt: { $exists: false } })
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
        const { roles } = getRequester(req);
        if (!isPrivileged(roles)) throw new AppError(403, 'FORBIDDEN', 'Only admin/ops can approve mediator KYC');
        const body = approveByIdSchema.parse(req.body);
        const user = await UserModel.findByIdAndUpdate(
          body.id,
          { kycStatus: 'verified', status: 'active' },
          { new: true }
        );
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'MEDIATOR_APPROVED', entityType: 'User', entityId: String(user._id) });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    approveUser: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = approveByIdSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);

        // Mediators can only approve their own buyers.
        if (roles.includes('mediator') && !isPrivileged(roles)) {
          const buyer = await UserModel.findById(body.id).lean();
          if (!buyer || (buyer as any).deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
          if (String((buyer as any).parentCode) !== String((requester as any)?.mediatorCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Cannot approve users outside your network');
          }
        }

        const user = await UserModel.findByIdAndUpdate(body.id, { isVerifiedByMediator: true }, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'BUYER_APPROVED', entityType: 'User', entityId: String(user._id) });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    rejectUser: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = rejectByIdSchema.parse(req.body);
        const { roles, user: requester } = getRequester(req);

        if (roles.includes('mediator') && !isPrivileged(roles)) {
          const buyer = await UserModel.findById(body.id).lean();
          if (!buyer || (buyer as any).deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
          if (String((buyer as any).parentCode) !== String((requester as any)?.mediatorCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Cannot reject users outside your network');
          }
        }

        const user = await UserModel.findByIdAndUpdate(body.id, { status: 'suspended' }, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        await writeAuditLog({ req, action: 'USER_REJECTED', entityType: 'User', entityId: String(user._id) });
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

            // CRITICAL ANTI-FRAUD: Mediator cannot verify orders from their own buyers
            // This prevents collusion where mediator approves fake orders
            const buyerUserId = String(order.userId);
            const buyer = await UserModel.findById(buyerUserId).select({ parentCode: 1 }).lean();
            const buyerMediatorCode = String((buyer as any)?.parentCode || '').trim();
            
            if (buyerMediatorCode === String((requester as any)?.mediatorCode)) {
              throw new AppError(
                403,
                'SELF_VERIFICATION_FORBIDDEN',
                'You cannot verify orders from your own buyers. Verification must be done by agency or admin.'
              );
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

        order.affiliateStatus = 'Pending_Cooling';
        const settleDate = new Date();
        settleDate.setDate(settleDate.getDate() + 14);
        order.expectedSettlementDate = settleDate;
        order.events = pushOrderEvent(order.events as any, {
          type: 'VERIFIED',
          at: new Date(),
          actorUserId: req.auth?.userId,
        }) as any;
        await order.save();

        await transitionOrderWorkflow({
          orderId: String(order._id),
          from: 'UNDER_REVIEW',
          to: 'APPROVED',
          actorUserId: String(req.auth?.userId || ''),
          metadata: { source: 'verifyOrderClaim' },
        });

        await writeAuditLog({ req, action: 'ORDER_VERIFIED', entityType: 'Order', entityId: String(order._id) });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    settleOrderPayment: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = settleOrderSchema.parse(req.body);
        const { roles } = getRequester(req);
        if (!isPrivileged(roles)) throw new AppError(403, 'FORBIDDEN', 'Only admin/ops can settle payments');
        const order = await OrderModel.findById(body.orderId);
        if (!order || order.deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

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
          deletedAt: { $exists: false },
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
        const mediatorCode = order.managerName;

        let isOverLimit = false;
        if (campaignId && mediatorCode) {
          const campaign = await CampaignModel.findById(campaignId).lean();
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
                deletedAt: { $exists: false },
              });
              if (settledCount >= assignedLimit) isOverLimit = true;
            }
          }
        }

        order.paymentStatus = 'Paid';
        order.affiliateStatus = isOverLimit ? 'Cap_Exceeded' : 'Approved_Settled';
        order.events = pushOrderEvent(order.events as any, {
          type: isOverLimit ? 'CAP_EXCEEDED' : 'SETTLED',
          at: new Date(),
          actorUserId: req.auth?.userId,
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

        // Credit wallets if order completed successfully
        if (!isOverLimit) {
          const buyerUserId = String(order.createdBy);
          const buyerCommissionPaise = order.items?.[0]?.commissionPaise || 0;

          // Credit buyer commission
          if (buyerCommissionPaise > 0) {
            await ensureWallet(buyerUserId);
            await applyWalletCredit({
              idempotencyKey: `order-commission-${order._id}`,
              type: 'commission_settle',
              ownerUserId: buyerUserId,
              amountPaise: buyerCommissionPaise,
              orderId: String(order._id),
              metadata: { reason: 'ORDER_COMMISSION' },
            });
          }

          // Credit mediator margin (payout - commission)
          // CRITICAL: Get payout from Deal record (the source of truth)
          if (campaignId && mediatorCode) {
            const productId = order.items?.[0]?.productId;
            const deal = await DealModel.findById(productId).lean();
            
            if (deal && !deal.deletedAt) {
              const mediatorPayoutPaise = deal.payoutPaise || 0;
              const mediatorMarginPaise = mediatorPayoutPaise - buyerCommissionPaise;

              if (mediatorMarginPaise > 0) {
                const mediator = await UserModel.findOne({ mediatorCode }).lean();
                if (mediator && !(mediator as any).deletedAt) {
                  const mediatorUserId = String(mediator._id);
                  await ensureWallet(mediatorUserId);
                  await applyWalletCredit({
                    idempotencyKey: `order-margin-${order._id}`,
                    type: 'commission_settle',
                    ownerUserId: mediatorUserId,
                    amountPaise: mediatorMarginPaise,
                    orderId: String(order._id),
                    metadata: { reason: 'ORDER_MARGIN' },
                  });
                }
              }
            }
          }
        }

        await writeAuditLog({ req, action: 'ORDER_SETTLED', entityType: 'Order', entityId: String(order._id), metadata: { affiliateStatus: order.affiliateStatus } });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    createCampaign: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createCampaignSchema.parse(req.body);
        const { roles } = getRequester(req);
        if (!isPrivileged(roles)) throw new AppError(403, 'FORBIDDEN', 'Only admin/ops can create campaigns via ops endpoint');

        const brand = await UserModel.findById(body.brandUserId).lean();
        if (!brand || (brand as any).deletedAt) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
        if (!((brand as any).roles || []).includes('brand')) throw new AppError(400, 'INVALID_BRAND', 'Invalid brand');
        if ((brand as any).status !== 'active') throw new AppError(409, 'BRAND_SUSPENDED', 'Brand is not active');

        const connected = Array.isArray((brand as any).connectedAgencies) ? (brand as any).connectedAgencies : [];
        const allowed = Array.isArray(body.allowedAgencies) ? body.allowedAgencies : [];
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
          allowedAgencyCodes: body.allowedAgencies,
          dealType: body.dealType,
          returnWindowDays: body.returnWindowDays ?? 14,
          createdBy: req.auth?.userId as any,
        });

        await writeAuditLog({ req, action: 'CAMPAIGN_CREATED', entityType: 'Campaign', entityId: String((campaign as any)._id) });
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

        // CRITICAL: Lock campaign on first slot assignment OR first order (whichever comes first)
        if ((campaign as any).locked) {
          throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is permanently locked after slot assignment');
        }

        const hasOrders = await OrderModel.exists({ 'items.campaignId': campaign._id, deletedAt: { $exists: false } });
        if (hasOrders) {
          throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is locked after first order; create a new campaign to change terms');
        }

        // Agency can only assign slots for campaigns explicitly allowed for that agency.
        if (roles.includes('agency') && !isPrivileged(roles)) {
          const agencyCode = String((requester as any)?.mediatorCode || '').trim();
          const allowed = Array.isArray(campaign.allowedAgencyCodes) ? campaign.allowedAgencyCodes : [];
          if (!allowed.includes(agencyCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Campaign not assigned to this agency');
          }
        }

        // NEW SCHEMA: assignments is Map<string, { limit: number, payout?: number }>
        const current = campaign.assignments instanceof Map ? campaign.assignments : new Map();
        for (const [code, assignment] of Object.entries(body.assignments)) {
          // Support both old format (number) and new format ({ limit, payout })
          const assignmentObj = typeof assignment === 'number' 
            ? { limit: assignment, payout: campaign.payoutPaise }
            : { limit: (assignment as any).limit, payout: (assignment as any).payout ?? campaign.payoutPaise };
          current.set(code, assignmentObj as any);
        }
        campaign.assignments = current as any;

        if (body.dealType) campaign.dealType = body.dealType as any;
        if (typeof body.price !== 'undefined') campaign.pricePaise = rupeesToPaise(body.price);
        if (typeof body.payout !== 'undefined') campaign.payoutPaise = rupeesToPaise(body.payout);

        // LOCK THE CAMPAIGN PERMANENTLY
        (campaign as any).locked = true;
        (campaign as any).lockedAt = new Date();
        (campaign as any).lockedReason = 'SLOT_ASSIGNMENT';

        await campaign.save();
        await writeAuditLog({ req, action: 'CAMPAIGN_SLOTS_ASSIGNED', entityType: 'Campaign', entityId: String(campaign._id) });
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
          const agencyCode = String((requester as any)?.parentCode || '').trim();
          const allowedAgencies = Array.isArray((campaign as any).allowedAgencyCodes) ? (campaign as any).allowedAgencyCodes : [];
          if (!allowedAgencies.includes(agencyCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Campaign not assigned to your agency');
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
          deletedAt: { $exists: false } 
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

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    payoutMediator: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = payoutMediatorSchema.parse(req.body);
        const { roles } = getRequester(req);
        if (!isPrivileged(roles)) throw new AppError(403, 'FORBIDDEN', 'Only admin/ops can process payouts');
        const user = await UserModel.findById(body.mediatorId);
        if (!user || user.deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

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
        });

        await applyWalletDebit({
          idempotencyKey: `payout_complete:${payout._id}`,
          type: 'payout_complete',
          ownerUserId: String(user._id),
          amountPaise,
          payoutId: payout._id as any,
          metadata: { provider: 'manual' },
        });

        await writeAuditLog({ req, action: 'PAYOUT_PROCESSED', entityType: 'Payout', entityId: String(payout._id), metadata: { beneficiaryUserId: String(user._id), amountPaise } });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    // Optional endpoint used by some UI versions.
    getTransactions: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const tx = await TransactionModel.find({ deletedAt: { $exists: false } })
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
