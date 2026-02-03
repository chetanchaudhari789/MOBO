import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { OrderModel } from '../models/Order.js';
import { adminUsersQuerySchema, reactivateOrderSchema, updateUserStatusSchema } from '../validations/admin.js';
import { toUiOrder, toUiUser, toUiRole, toUiDeal } from '../utils/uiMappers.js';
import { writeAuditLog } from '../services/audit.js';
import { SuspensionModel } from '../models/Suspension.js';
import { DealModel } from '../models/Deal.js';
import { CampaignModel } from '../models/Campaign.js';
import { freezeOrders, reactivateOrder as reactivateOrderWorkflow } from '../services/orderWorkflow.js';
import { getAgencyCodeForMediatorCode, listMediatorCodesForAgency } from '../services/lineage.js';
import { SystemConfigModel } from '../models/SystemConfig.js';
import { updateSystemConfigSchema } from '../validations/systemConfig.js';
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

        const users = await UserModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        const wallets = await WalletModel.find({ ownerUserId: { $in: users.map((u) => u._id) } }).lean();
        const byUserId = new Map(wallets.map((w) => [String(w.ownerUserId), w]));

        res.json(users.map((u) => toUiUser(u, byUserId.get(String(u._id)))));
      } catch (err) {
        next(err);
      }
    },

    getFinancials: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const orders = await OrderModel.find({ deletedAt: null })
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
        const [users, orders] = await Promise.all([
          UserModel.find({ deletedAt: null }).select({ role: 1 }).lean(),
          OrderModel.find({ deletedAt: null }).select({ totalPaise: 1, affiliateStatus: 1 }).lean(),
        ]);

        const counts: any = { total: users.length, user: 0, mediator: 0, agency: 0, brand: 0 };
        for (const u of users) {
          const ui = toUiRole(String(u.role));
          if (counts[ui] !== undefined) counts[ui] += 1;
        }

        const totalRevenue = orders.reduce((sum, o) => sum + Math.round((o.totalPaise ?? 0) / 100), 0);
        const pendingRevenue = orders
          .filter((o) => o.affiliateStatus === 'Pending_Cooling')
          .reduce((sum, o) => sum + Math.round((o.totalPaise ?? 0) / 100), 0);

        const riskOrders = orders.filter((o) => o.affiliateStatus === 'Fraud_Alert' || o.affiliateStatus === 'Unchecked').length;

        res.json({
          totalRevenue,
          pendingRevenue,
          totalOrders: orders.length,
          riskOrders,
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

        const orders = await OrderModel.find({ createdAt: { $gte: since }, deletedAt: null })
          .select({ createdAt: 1, totalPaise: 1 })
          .lean();

        const buckets = new Map<string, number>();
        for (let i = 0; i < 7; i += 1) {
          const d = new Date(since);
          d.setDate(since.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          buckets.set(key, 0);
        }

        for (const o of orders) {
          const key = new Date(o.createdAt as any).toISOString().slice(0, 10);
          if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + Math.round((o.totalPaise ?? 0) / 100));
        }

        const data = Array.from(buckets.entries()).map(([date, revenue]) => ({ date, revenue }));
        res.json(data);
      } catch (err) {
        next(err);
      }
    },

    getProducts: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const deals = await DealModel.find({ deletedAt: null })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();
        
        res.json(deals.map(toUiDeal));
      } catch (err) {
        next(err);
      }
    },

    updateUserStatus: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = updateUserStatusSchema.parse(req.body);
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
  };
}
