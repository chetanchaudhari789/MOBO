import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { OrderModel } from '../models/Order.js';
import { adminUsersQuerySchema, adminFinancialsQuerySchema, adminProductsQuerySchema, reactivateOrderSchema, updateUserStatusSchema } from '../validations/admin.js';
import { toUiOrder, toUiUser, toUiRole, toUiDeal } from '../utils/uiMappers.js';
import { writeAuditLog } from '../services/audit.js';
import { SuspensionModel } from '../models/Suspension.js';
import { DealModel } from '../models/Deal.js';
import { CampaignModel } from '../models/Campaign.js';
import { PayoutModel } from '../models/Payout.js';
import { freezeOrders, reactivateOrder as reactivateOrderWorkflow } from '../services/orderWorkflow.js';
import { getAgencyCodeForMediatorCode, listMediatorCodesForAgency } from '../services/lineage.js';
import { SystemConfigModel } from '../models/SystemConfig.js';
import { updateSystemConfigSchema } from '../validations/systemConfig.js';
import { AuditLogModel } from '../models/AuditLog.js';
import type { Role } from '../middleware/auth.js';
import { publishRealtime } from '../services/realtimeHub.js';

function roleToDb(role: string): string | null {
  const r = role.toLowerCase();
  if (r === 'all') return null;
  if (r === 'user') return 'shopper';
  if (r === 'mediator') return 'mediator';
  if (r === 'agency') return 'agency';
  if (r === 'brand') return 'brand';
  if (r === 'admin') return 'admin';
  return null;
}

export function makeAdminController() {
  return {
    getSystemConfig: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const doc = await SystemConfigModel.findOne({ key: 'system' }).lean();
        res.json({
          adminContactEmail: doc?.adminContactEmail ?? 'admin@buzzma.world',
        });
      } catch (err) {
        next(err);
      }
    },

    updateSystemConfig: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = updateSystemConfigSchema.parse(req.body);
        const update: any = {};
        if (typeof body.adminContactEmail !== 'undefined') update.adminContactEmail = body.adminContactEmail;

        const doc = await SystemConfigModel.findOneAndUpdate(
          { key: 'system' },
          { $set: update, $setOnInsert: { key: 'system' } },
          { upsert: true, new: true }
        ).lean();

        await writeAuditLog({
          req,
          action: 'SYSTEM_CONFIG_UPDATED',
          entityType: 'SystemConfig',
          entityId: 'system',
          metadata: { updatedFields: Object.keys(update) },
        });

        res.json({ adminContactEmail: doc?.adminContactEmail ?? body.adminContactEmail ?? 'admin@buzzma.world' });
      } catch (err) {
        next(err);
      }
    },
    getUsers: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const queryParams = adminUsersQuerySchema.parse(req.query);
        const dbRole = roleToDb(queryParams.role);
        if (dbRole === null && queryParams.role !== 'all') {
          throw new AppError(400, 'INVALID_ROLE', 'Invalid role filter');
        }

        const query: any = { deletedAt: null };
        if (dbRole) query.role = dbRole;
        if (queryParams.status && queryParams.status !== 'all') {
          query.status = queryParams.status;
        }
        if (queryParams.search) {
          const escaped = queryParams.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = { $regex: escaped, $options: 'i' };
          query.$or = [{ name: regex }, { mobile: regex }, { email: regex }, { mediatorCode: regex }];
        }

        const users = await UserModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        const wallets = await WalletModel.find({ ownerUserId: { $in: users.map((u) => u._id) } }).lean();
        const byUserId = new Map(wallets.map((w) => [String(w.ownerUserId), w]));

        res.json(users.map((u) => toUiUser(u, byUserId.get(String(u._id)))));
      } catch (err) {
        next(err);
      }
    },

    getFinancials: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const queryParams = adminFinancialsQuerySchema.parse(req.query);
        const query: any = { deletedAt: null };
        if (queryParams.status && queryParams.status !== 'all') {
          query.affiliateStatus = queryParams.status;
        }

        const orders = await OrderModel.find(query)
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();
        res.json(orders.map(toUiOrder));
      } catch (err) {
        next(err);
      }
    },

    getStats: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        // Use aggregation pipelines to avoid loading all docs into memory
        const [roleCounts, orderStats] = await Promise.all([
          UserModel.aggregate([
            { $match: { deletedAt: null } },
            { $group: { _id: '$role', count: { $sum: 1 } } },
          ]),
          OrderModel.aggregate([
            { $match: { deletedAt: null } },
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalRevenuePaise: { $sum: { $ifNull: ['$totalPaise', 0] } },
                pendingRevenuePaise: {
                  $sum: {
                    $cond: [{ $eq: ['$affiliateStatus', 'Pending_Cooling'] }, { $ifNull: ['$totalPaise', 0] }, 0],
                  },
                },
                riskOrders: {
                  $sum: {
                    $cond: [{ $in: ['$affiliateStatus', ['Fraud_Alert', 'Unchecked']] }, 1, 0],
                  },
                },
              },
            },
          ]),
        ]);

        const counts: any = { total: 0, user: 0, mediator: 0, agency: 0, brand: 0 };
        for (const rc of roleCounts) {
          const ui = toUiRole(String(rc._id));
          if (counts[ui] !== undefined) counts[ui] += rc.count;
          counts.total += rc.count;
        }

        const os = orderStats[0] || { totalOrders: 0, totalRevenuePaise: 0, pendingRevenuePaise: 0, riskOrders: 0 };

        res.json({
          totalRevenue: Math.round(os.totalRevenuePaise / 100),
          pendingRevenue: Math.round(os.pendingRevenuePaise / 100),
          totalOrders: os.totalOrders,
          riskOrders: os.riskOrders,
          counts,
        });
      } catch (err) {
        next(err);
      }
    },

    getGrowth: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const since = new Date();
        since.setDate(since.getDate() - 6);
        since.setHours(0, 0, 0, 0);

        // Use aggregation to avoid loading all orders into memory
        const pipeline = await OrderModel.aggregate([
          { $match: { createdAt: { $gte: since }, deletedAt: null } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              revenue: { $sum: { $ifNull: ['$totalPaise', 0] } },
            },
          },
        ]);

        const revenueByDate = new Map(pipeline.map((b) => [b._id, Math.round(b.revenue / 100)]));

        const data: Array<{ date: string; revenue: number }> = [];
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(since);
          d.setDate(since.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          data.push({ date: key, revenue: revenueByDate.get(key) || 0 });
        }

        res.json(data);
      } catch (err) {
        next(err);
      }
    },

    getProducts: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const queryParams = adminProductsQuerySchema.parse(req.query);
        const query: any = { deletedAt: null };
        if (queryParams.active && queryParams.active !== 'all') {
          query.active = queryParams.active === 'true';
        }
        if (queryParams.search) {
          const escaped = queryParams.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = { $regex: escaped, $options: 'i' };
          query.$or = [{ title: regex }, { mediatorCode: regex }, { platform: regex }];
        }

        const deals = await DealModel.find(query)
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();
        
        res.json(deals.map(toUiDeal));
      } catch (err) {
        next(err);
      }
    },

    deleteDeal: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dealId = String(req.params.dealId || '').trim();
        if (!dealId) throw new AppError(400, 'INVALID_DEAL_ID', 'dealId required');

        const deal = await DealModel.findById(dealId).lean();
        if (!deal || (deal as any).deletedAt) throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');

        const hasOrders = await OrderModel.exists({ deletedAt: null, 'items.productId': dealId });
        if (hasOrders) throw new AppError(409, 'DEAL_HAS_ORDERS', 'Cannot delete a deal with orders');

        const deletedBy = req.auth?.userId as any;
        const updated = await DealModel.updateOne(
          { _id: (deal as any)._id, deletedAt: null },
          { $set: { deletedAt: new Date(), deletedBy, updatedBy: deletedBy, active: false } }
        );
        if (!updated.modifiedCount) throw new AppError(409, 'DEAL_ALREADY_DELETED', 'Deal already deleted');

        await writeAuditLog({
          req,
          action: 'DEAL_DELETED',
          entityType: 'Deal',
          entityId: String((deal as any)._id),
          metadata: { mediatorCode: (deal as any).mediatorCode },
        });

        const mediatorCode = String((deal as any).mediatorCode || '').trim();
        publishRealtime({
          type: 'deals.changed',
          ts: new Date().toISOString(),
          payload: { dealId: String((deal as any)._id) },
          audience: {
            roles: ['admin', 'ops'],
            ...(mediatorCode ? { mediatorCodes: [mediatorCode] } : {}),
          },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    deleteUser: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = String(req.params.userId || '').trim();
        if (!userId) throw new AppError(400, 'INVALID_USER_ID', 'userId required');

        const user = await UserModel.findById(userId).lean();
        if (!user || (user as any).deletedAt) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        const roles = Array.isArray((user as any).roles)
          ? (user as any).roles.map(String)
          : [String((user as any).role || '')].filter(Boolean);
        if (roles.includes('admin') || roles.includes('ops')) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot delete privileged users');
        }

        const mediatorCode = String((user as any).mediatorCode || '').trim();

        const hasCampaigns = await CampaignModel.exists({ brandUserId: userId as any, deletedAt: null });
        if (hasCampaigns) throw new AppError(409, 'USER_HAS_CAMPAIGNS', 'User has campaigns');

        if (mediatorCode) {
          const hasDeals = await DealModel.exists({ mediatorCode, deletedAt: null });
          if (hasDeals) throw new AppError(409, 'USER_HAS_DEALS', 'User has deals');
        }

        const orderOr: any[] = [{ userId: userId as any }, { brandUserId: userId as any }, { createdBy: userId as any }];
        if (mediatorCode && roles.includes('mediator')) {
          orderOr.push({ managerName: mediatorCode });
        }
        if (mediatorCode && roles.includes('agency')) {
          const mediatorCodes = await listMediatorCodesForAgency(mediatorCode);
          if (mediatorCodes.length) orderOr.push({ managerName: { $in: mediatorCodes } });
        }

        const hasOrders = await OrderModel.exists({ deletedAt: null, $or: orderOr });
        if (hasOrders) throw new AppError(409, 'USER_HAS_ORDERS', 'User has orders');

        const hasPendingPayout = await PayoutModel.exists({
          beneficiaryUserId: userId as any,
          status: { $in: ['requested', 'processing'] },
          deletedAt: null,
        });
        if (hasPendingPayout) throw new AppError(409, 'USER_HAS_PAYOUTS', 'User has pending payouts');

        const wallet = await WalletModel.findOne({ ownerUserId: userId as any, deletedAt: null }).lean();
        const available = Number((wallet as any)?.availablePaise ?? 0);
        const pending = Number((wallet as any)?.pendingPaise ?? 0);
        const locked = Number((wallet as any)?.lockedPaise ?? 0);
        if (available > 0 || pending > 0 || locked > 0) {
          throw new AppError(409, 'WALLET_NOT_EMPTY', 'Wallet has funds; cannot delete user');
        }

        const deletedBy = req.auth?.userId as any;
        if (wallet) {
          await WalletModel.updateOne(
            { _id: (wallet as any)._id, deletedAt: null },
            { $set: { deletedAt: new Date(), deletedBy, updatedBy: deletedBy } }
          );
        }

        const updated = await UserModel.updateOne(
          { _id: (user as any)._id, deletedAt: null },
          { $set: { deletedAt: new Date(), deletedBy, updatedBy: deletedBy } }
        );
        if (!updated.modifiedCount) throw new AppError(409, 'USER_ALREADY_DELETED', 'User already deleted');

        await writeAuditLog({
          req,
          action: 'USER_DELETED',
          entityType: 'User',
          entityId: String((user as any)._id),
          metadata: { role: String((user as any).role || ''), mediatorCode },
        });

        publishRealtime({
          type: 'users.changed',
          ts: new Date().toISOString(),
          payload: { userId: String((user as any)._id) },
          audience: { roles: ['admin'] },
        });
        publishRealtime({
          type: 'wallets.changed',
          ts: new Date().toISOString(),
          audience: { roles: ['admin'], userIds: [String((user as any)._id)] },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    deleteWallet: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = String(req.params.userId || '').trim();
        if (!userId) throw new AppError(400, 'INVALID_USER_ID', 'userId required');

        const wallet = await WalletModel.findOne({ ownerUserId: userId, deletedAt: null }).lean();
        if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

        const available = Number((wallet as any).availablePaise ?? 0);
        const pending = Number((wallet as any).pendingPaise ?? 0);
        const locked = Number((wallet as any).lockedPaise ?? 0);
        if (available > 0 || pending > 0 || locked > 0) {
          throw new AppError(409, 'WALLET_NOT_EMPTY', 'Wallet has funds; cannot delete');
        }

        const hasPendingPayout = await PayoutModel.exists({
          beneficiaryUserId: userId as any,
          status: { $in: ['requested', 'processing'] },
          deletedAt: null,
        });
        if (hasPendingPayout) {
          throw new AppError(409, 'PAYOUT_PENDING', 'User has pending payouts; cannot delete wallet');
        }

        const deletedBy = req.auth?.userId as any;
        const updated = await WalletModel.updateOne(
          { ownerUserId: userId, deletedAt: null },
          { $set: { deletedAt: new Date(), deletedBy, updatedBy: deletedBy } }
        );
        if (!updated.modifiedCount) {
          throw new AppError(409, 'WALLET_ALREADY_DELETED', 'Wallet already deleted');
        }

        await writeAuditLog({
          req,
          action: 'WALLET_DELETED',
          entityType: 'Wallet',
          entityId: String((wallet as any)._id),
          metadata: { ownerUserId: userId },
        });

        publishRealtime({
          type: 'wallets.changed',
          ts: new Date().toISOString(),
          audience: { roles: ['admin'], userIds: [userId] },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    updateUserStatus: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = updateUserStatusSchema.parse(req.body);

        // Guard: prevent admin from suspending themselves (could cause unrecoverable lockout).
        if (String(body.userId) === String(req.auth?.userId) && body.status === 'suspended') {
          throw new AppError(400, 'CANNOT_SELF_SUSPEND', 'Cannot suspend your own account');
        }

        const before = await UserModel.findById(body.userId).select({ status: 1 }).lean();
        const user = await UserModel.findByIdAndUpdate(body.userId, { status: body.status }, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const statusChanged = !!before && before.status !== user.status;
        const adminUserId = req.auth?.userId;
  if (adminUserId && statusChanged) {
          if (user.status === 'suspended') {
            await SuspensionModel.create({
              targetUserId: user._id,
              action: 'suspend',
              reason: body.reason,
              adminUserId,
            });

            // Freeze active workflows immediately; do NOT auto-resume after unsuspension.
            const roles = Array.isArray((user as any).roles) ? (user as any).roles.map(String) : [String((user as any).role || '')];
            const mediatorCode = String((user as any).mediatorCode || '').trim();

            if (roles.includes('shopper')) {
              await freezeOrders({ query: { userId: user._id }, reason: 'USER_SUSPENDED', actorUserId: adminUserId });
            }

            if (roles.includes('mediator') && mediatorCode) {
              await DealModel.updateMany({ mediatorCode, deletedAt: null }, { $set: { active: false } });
              await freezeOrders({ query: { managerName: mediatorCode }, reason: 'MEDIATOR_SUSPENDED', actorUserId: adminUserId });
              const agencyCode = (await getAgencyCodeForMediatorCode(mediatorCode)) || '';
              publishRealtime({
                type: 'deals.changed',
                ts: new Date().toISOString(),
                payload: { mediatorCode },
                audience: {
                  roles: ['admin', 'ops'],
                  mediatorCodes: [mediatorCode],
                  parentCodes: [mediatorCode],
                  ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
                },
              });
            }

            if (roles.includes('agency') && mediatorCode) {
              const mediatorCodes = await listMediatorCodesForAgency(mediatorCode);
              if (mediatorCodes.length) {
                await DealModel.updateMany({ mediatorCode: { $in: mediatorCodes }, deletedAt: null }, { $set: { active: false } });
                await freezeOrders({ query: { managerName: { $in: mediatorCodes } }, reason: 'AGENCY_SUSPENDED', actorUserId: adminUserId });
                publishRealtime({
                  type: 'deals.changed',
                  ts: new Date().toISOString(),
                  payload: { agencyCode: mediatorCode, mediatorCodes },
                  audience: {
                    roles: ['admin', 'ops'],
                    agencyCodes: [mediatorCode],
                    mediatorCodes,
                    parentCodes: mediatorCodes,
                  },
                });
              }
            }

            if (roles.includes('brand')) {
              await CampaignModel.updateMany(
                { brandUserId: user._id, deletedAt: null, status: { $in: ['active', 'draft'] } },
                { $set: { status: 'paused' } }
              );
              await freezeOrders({ query: { brandUserId: user._id }, reason: 'BRAND_SUSPENDED', actorUserId: adminUserId });
            }
          }
          if (before.status === 'suspended' && user.status === 'active') {
            await SuspensionModel.create({
              targetUserId: user._id,
              action: 'unsuspend',
              reason: body.reason,
              adminUserId,
            });

            // No auto-unfreeze here by design.
          }
        }

        await writeAuditLog({
          req,
          action: 'USER_STATUS_UPDATED',
          entityType: 'User',
          entityId: String(user._id),
          metadata: { from: before?.status, to: user.status, reason: body.reason },
        });

        if (statusChanged) {
          publishRealtime({
            type: 'users.changed',
            ts: new Date().toISOString(),
            payload: { userId: String(user._id), status: user.status },
            audience: { roles: ['admin', 'ops'], userIds: [String(user._id)] },
          });
          const privilegedRoles: Role[] = ['admin', 'ops'];
          const audience = { roles: privilegedRoles, userIds: [String(user._id)] };
          publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });
        }
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    reactivateOrder: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = reactivateOrderSchema.parse(req.body);
        const adminUserId = req.auth?.userId;
        if (!adminUserId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const order = await reactivateOrderWorkflow({ orderId: body.orderId, actorUserId: adminUserId, reason: body.reason });

        await writeAuditLog({
          req,
          action: 'ORDER_REACTIVATED',
          entityType: 'Order',
          entityId: String(order._id),
          metadata: { reason: body.reason },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    getAuditLogs: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const {
          action,
          entityType,
          entityId,
          actorUserId,
          from,
          to,
          page: pageStr,
          limit: limitStr,
        } = req.query as Record<string, string | undefined>;

        const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(limitStr || '50', 10) || 50));
        const skip = (page - 1) * limit;

        const filter: Record<string, any> = {};
        if (action && typeof action === 'string') filter.action = action;
        if (entityType && typeof entityType === 'string') filter.entityType = entityType;
        if (entityId && typeof entityId === 'string') filter.entityId = entityId;
        if (actorUserId && typeof actorUserId === 'string') filter.actorUserId = actorUserId;

        if (from || to) {
          filter.createdAt = {};
          if (from) {
            const d = new Date(from);
            if (!isNaN(d.getTime())) filter.createdAt.$gte = d;
          }
          if (to) {
            const d = new Date(to);
            if (!isNaN(d.getTime())) filter.createdAt.$lte = d;
          }
          if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
        }

        const [logs, total] = await Promise.all([
          AuditLogModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
          AuditLogModel.countDocuments(filter),
        ]);

        res.json({
          logs,
          total,
          page,
          pages: Math.ceil(total / limit),
        });
      } catch (err) {
        next(err);
      }
    },
  };
}
