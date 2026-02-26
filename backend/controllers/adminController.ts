import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { idWhere } from '../utils/idWhere.js';
import { prisma } from '../database/prisma.js';
import { orderLog, businessLog, securityLog } from '../config/logger.js';
import { logChangeEvent } from '../config/appLogs.js';
import { adminUsersQuerySchema, adminFinancialsQuerySchema, adminProductsQuerySchema, reactivateOrderSchema, updateUserStatusSchema } from '../validations/admin.js';
import { toUiOrder, toUiUser, toUiRole, toUiDeal } from '../utils/uiMappers.js';
import { writeAuditLog } from '../services/audit.js';
import { freezeOrders, reactivateOrder as reactivateOrderWorkflow } from '../services/orderWorkflow.js';
import { getAgencyCodeForMediatorCode, listMediatorCodesForAgency } from '../services/lineage.js';
import { updateSystemConfigSchema } from '../validations/systemConfig.js';
import type { Role } from '../middleware/auth.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { pgUser, pgWallet, pgOrder, pgDeal } from '../utils/pgMappers.js';

function db() { return prisma(); }

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
        const doc = await db().systemConfig.findFirst({ where: { key: 'system' } });
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

        const doc = await db().systemConfig.upsert({
          where: { key: 'system' },
          create: { key: 'system', ...update },
          update,
        });

        await writeAuditLog({
          req,
          action: 'SYSTEM_CONFIG_UPDATED',
          entityType: 'SystemConfig',
          entityId: 'system',
          metadata: { updatedFields: Object.keys(update) },
        });
        securityLog.info('System config updated', { updatedFields: Object.keys(update), actorUserId: req.auth?.userId });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'SystemConfig', entityId: 'system', action: 'CONFIG_UPDATED', changedFields: Object.keys(update), before: {}, after: update });

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

        const where: any = { deletedAt: null };
        if (dbRole) where.roles = { has: dbRole as any };
        if (queryParams.status && queryParams.status !== 'all') {
          where.status = queryParams.status;
        }
        if (queryParams.search) {
          where.OR = [
            { name: { contains: queryParams.search, mode: 'insensitive' } },
            { mobile: { contains: queryParams.search, mode: 'insensitive' } },
            { email: { contains: queryParams.search, mode: 'insensitive' } },
            { mediatorCode: { contains: queryParams.search, mode: 'insensitive' } },
          ];
        }

        const users = await db().user.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
        const wallets = await db().wallet.findMany({ where: { ownerUserId: { in: users.map(u => u.id) }, deletedAt: null } });
        const byUserId = new Map(wallets.map(w => [w.ownerUserId, w]));

        res.json(users.map(u => toUiUser(pgUser(u), byUserId.has(u.id) ? pgWallet(byUserId.get(u.id)!) : undefined)));
      } catch (err) {
        next(err);
      }
    },

    getFinancials: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const queryParams = adminFinancialsQuerySchema.parse(req.query);
        const where: any = { deletedAt: null };
        if (queryParams.status && queryParams.status !== 'all') {
          where.affiliateStatus = queryParams.status;
        }

        const orders = await db().order.findMany({
          where,
          include: { items: true },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        });
        const mapped = orders.map(o => {
          try { return toUiOrder(pgOrder(o)); }
          catch (e) { orderLog.error(`[admin/getOrders] toUiOrder failed for ${o.id}`, { error: e }); return null; }
        }).filter(Boolean);
        res.json(mapped);
      } catch (err) {
        next(err);
      }
    },

    getStats: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const [roleCounts, orderStats] = await Promise.all([
          db().$queryRaw<Array<{ role: string; count: number }>>`
            SELECT r AS role, COUNT(*)::int AS count
            FROM "users", UNNEST(roles) AS r
            WHERE "deleted_at" IS NULL
            GROUP BY r`,
          db().$queryRaw<Array<{ total_orders: number; total_revenue_paise: number; pending_revenue_paise: number; risk_orders: number }>>`
            SELECT
              COUNT(*)::int AS total_orders,
              COALESCE(SUM("total_paise"), 0)::int AS total_revenue_paise,
              COALESCE(SUM(CASE WHEN "affiliate_status"::text = 'Pending_Cooling' THEN "total_paise" ELSE 0 END), 0)::int AS pending_revenue_paise,
              COALESCE(SUM(CASE WHEN "affiliate_status"::text IN ('Fraud_Alert', 'Unchecked') THEN 1 ELSE 0 END), 0)::int AS risk_orders
            FROM "orders"
            WHERE "deleted_at" IS NULL`,
        ]);

        const counts: any = { total: 0, user: 0, mediator: 0, agency: 0, brand: 0 };
        for (const rc of roleCounts) {
          const ui = toUiRole(String(rc.role));
          if (counts[ui] !== undefined) counts[ui] += Number(rc.count);
          counts.total += Number(rc.count);
        }

        const os = orderStats[0] || { total_orders: 0, total_revenue_paise: 0, pending_revenue_paise: 0, risk_orders: 0 };

        res.json({
          totalRevenue: Math.round(Number(os.total_revenue_paise) / 100),
          pendingRevenue: Math.round(Number(os.pending_revenue_paise) / 100),
          totalOrders: Number(os.total_orders),
          riskOrders: Number(os.risk_orders),
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

        const pipeline = await db().$queryRaw<Array<{ date: string; revenue: number }>>`
          SELECT TO_CHAR("created_at", 'YYYY-MM-DD') AS date,
                 COALESCE(SUM("total_paise"), 0)::int AS revenue
          FROM "orders"
          WHERE "created_at" >= ${since} AND "deleted_at" IS NULL
          GROUP BY TO_CHAR("created_at", 'YYYY-MM-DD')`;

        const revenueByDate = new Map(pipeline.map(b => [b.date, Math.round(Number(b.revenue) / 100)]));

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
        const where: any = { deletedAt: null };
        if (queryParams.active && queryParams.active !== 'all') {
          where.active = queryParams.active === 'true';
        }
        if (queryParams.search) {
          where.OR = [
            { title: { contains: queryParams.search, mode: 'insensitive' } },
            { mediatorCode: { contains: queryParams.search, mode: 'insensitive' } },
            { platform: { contains: queryParams.search, mode: 'insensitive' } },
          ];
        }

        const deals = await db().deal.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
        res.json(deals.map(d => toUiDeal(pgDeal(d))));
      } catch (err) {
        next(err);
      }
    },

    deleteDeal: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dealId = String(req.params.dealId || '').trim();
        if (!dealId) throw new AppError(400, 'INVALID_DEAL_ID', 'dealId required');

        const deal = await db().deal.findFirst({ where: { ...idWhere(dealId), deletedAt: null } });
        if (!deal) throw new AppError(404, 'DEAL_NOT_FOUND', 'Deal not found');

        // Check for orders referencing this deal via order items
        const hasOrders = await db().orderItem.findFirst({
          where: { productId: dealId, order: { deletedAt: null } },
          select: { id: true },
        });
        if (hasOrders) throw new AppError(409, 'DEAL_HAS_ORDERS', 'Cannot delete a deal with orders');

        const pgUserId = (req.auth as any)?.pgUserId as string | undefined;
        await db().deal.update({
          where: { id: deal.id },
          data: { deletedAt: new Date(), deletedBy: pgUserId, updatedBy: pgUserId, active: false },
        });

        await writeAuditLog({
          req,
          action: 'DEAL_DELETED',
          entityType: 'Deal',
          entityId: deal.mongoId!,
          metadata: { mediatorCode: deal.mediatorCode },
        });
        businessLog.info('Deal deleted by admin', { dealId: deal.mongoId, mediatorCode: deal.mediatorCode, title: deal.title });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Deal', entityId: deal.mongoId!, action: 'DEAL_DELETED', changedFields: ['deletedAt', 'active'], before: { active: true }, after: { active: false, deletedAt: new Date().toISOString() } });

        const mediatorCode = String(deal.mediatorCode || '').trim();
        publishRealtime({
          type: 'deals.changed',
          ts: new Date().toISOString(),
          payload: { dealId: deal.mongoId! },
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

        const user = await db().user.findFirst({ where: { ...idWhere(userId), deletedAt: null } });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        const roles = Array.isArray(user.roles) ? (user.roles as string[]) : [];
        if (roles.includes('admin') || roles.includes('ops')) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot delete privileged users');
        }

        const mediatorCode = String(user.mediatorCode || '').trim();

        const hasCampaigns = await db().campaign.findFirst({ where: { brandUserId: user.id, deletedAt: null }, select: { id: true } });
        if (hasCampaigns) throw new AppError(409, 'USER_HAS_CAMPAIGNS', 'User has campaigns');

        if (mediatorCode) {
          const hasDeals = await db().deal.findFirst({ where: { mediatorCode, deletedAt: null }, select: { id: true } });
          if (hasDeals) throw new AppError(409, 'USER_HAS_DEALS', 'User has deals');
        }

        const orderOr: any[] = [{ userId: user.id }, { brandUserId: user.id }, { createdBy: user.id }];
        if (mediatorCode && roles.includes('mediator')) {
          orderOr.push({ managerName: mediatorCode });
        }
        if (mediatorCode && roles.includes('agency')) {
          const mediatorCodes = await listMediatorCodesForAgency(mediatorCode);
          if (mediatorCodes.length) orderOr.push({ managerName: { in: mediatorCodes } });
        }

        const hasOrders = await db().order.findFirst({ where: { deletedAt: null, OR: orderOr }, select: { id: true } });
        if (hasOrders) throw new AppError(409, 'USER_HAS_ORDERS', 'User has orders');

        const hasPendingPayout = await db().payout.findFirst({
          where: { beneficiaryUserId: user.id, status: { in: ['requested', 'processing'] as any }, deletedAt: null },
          select: { id: true },
        });
        if (hasPendingPayout) throw new AppError(409, 'USER_HAS_PAYOUTS', 'User has pending payouts');

        const wallet = await db().wallet.findFirst({ where: { ownerUserId: user.id, deletedAt: null } });
        const available = Number(wallet?.availablePaise ?? 0);
        const pending = Number(wallet?.pendingPaise ?? 0);
        const locked = Number(wallet?.lockedPaise ?? 0);
        if (available > 0 || pending > 0 || locked > 0) {
          throw new AppError(409, 'WALLET_NOT_EMPTY', 'Wallet has funds; cannot delete user');
        }

        const pgUserId = (req.auth as any)?.pgUserId as string | undefined;
        if (wallet) {
          await db().wallet.update({
            where: { id: wallet.id },
            data: { deletedAt: new Date(), deletedBy: pgUserId, updatedBy: pgUserId },
          });
        }

        await db().user.update({
          where: { id: user.id },
          data: { deletedAt: new Date(), deletedBy: pgUserId, updatedBy: pgUserId },
        });

        await writeAuditLog({
          req,
          action: 'USER_DELETED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: { role: roles.join(','), mediatorCode },
        });
        securityLog.info('User deleted by admin', { userId: user.mongoId, roles: roles.join(','), mediatorCode });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'User', entityId: user.mongoId!, action: 'USER_DELETED', changedFields: ['deletedAt'], before: { status: user.status }, after: { deletedAt: new Date().toISOString() } });

        publishRealtime({
          type: 'users.changed',
          ts: new Date().toISOString(),
          payload: { userId: user.mongoId! },
          audience: { roles: ['admin'] },
        });
        publishRealtime({
          type: 'wallets.changed',
          ts: new Date().toISOString(),
          audience: { roles: ['admin'], userIds: [user.mongoId!] },
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

        // Resolve PG UUID for the user
        const user = await db().user.findFirst({ where: { ...idWhere(userId), deletedAt: null }, select: { id: true, mongoId: true } });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        const wallet = await db().wallet.findFirst({ where: { ownerUserId: user.id, deletedAt: null } });
        if (!wallet) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

        const available = Number(wallet.availablePaise ?? 0);
        const pending = Number(wallet.pendingPaise ?? 0);
        const locked = Number(wallet.lockedPaise ?? 0);
        if (available > 0 || pending > 0 || locked > 0) {
          throw new AppError(409, 'WALLET_NOT_EMPTY', 'Wallet has funds; cannot delete');
        }

        const hasPendingPayout = await db().payout.findFirst({
          where: { beneficiaryUserId: user.id, status: { in: ['requested', 'processing'] as any }, deletedAt: null },
          select: { id: true },
        });
        if (hasPendingPayout) {
          throw new AppError(409, 'PAYOUT_PENDING', 'User has pending payouts; cannot delete wallet');
        }

        const pgUserId = (req.auth as any)?.pgUserId as string | undefined;
        await db().wallet.update({
          where: { id: wallet.id },
          data: { deletedAt: new Date(), deletedBy: pgUserId, updatedBy: pgUserId },
        });

        await writeAuditLog({
          req,
          action: 'WALLET_DELETED',
          entityType: 'Wallet',
          entityId: wallet.mongoId || wallet.id,
          metadata: { ownerUserId: userId },
        });
        businessLog.info('Wallet deleted by admin', { walletId: wallet.mongoId || wallet.id, ownerUserId: userId });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Wallet', entityId: wallet.mongoId || wallet.id, action: 'WALLET_DELETED', changedFields: ['deletedAt'], before: { deletedAt: null }, after: { deletedAt: new Date().toISOString() } });

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

        const before = await db().user.findFirst({ where: { ...idWhere(body.userId), deletedAt: null } });
        if (!before) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        if (before.deletedAt) throw new AppError(409, 'USER_DELETED', 'Cannot update status of a deleted user');

        const user = await db().user.update({
          where: { id: before.id },
          data: { status: body.status as any },
        });

        const statusChanged = before.status !== user.status;
        const adminMongoId = req.auth?.userId;
        const adminPgId = (req.auth as any)?.pgUserId as string | undefined;

        if (adminMongoId && statusChanged) {
          if (user.status === 'suspended') {
            await db().suspension.create({
              data: {
                mongoId: randomUUID(),
                targetUserId: user.id,
                action: 'suspend' as any,
                reason: body.reason,
                adminUserId: adminPgId!,
              },
            });

            // Freeze active workflows immediately; do NOT auto-resume after unsuspension.
            const roles = Array.isArray(user.roles) ? (user.roles as string[]) : [];
            const mediatorCode = String(user.mediatorCode || '').trim();

            if (roles.includes('shopper')) {
              await freezeOrders({ query: { userId: user.id }, reason: 'USER_SUSPENDED', actorUserId: adminPgId });
              writeAuditLog({ req, action: 'ORDERS_FROZEN_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'USER_SUSPENDED', role: 'shopper' } }).catch(() => { });
            }

            if (roles.includes('mediator') && mediatorCode) {
              await db().deal.updateMany({ where: { mediatorCode, deletedAt: null }, data: { active: false } });
              await freezeOrders({ query: { managerName: mediatorCode }, reason: 'MEDIATOR_SUSPENDED', actorUserId: adminPgId });
              writeAuditLog({ req, action: 'DEALS_DEACTIVATED_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'MEDIATOR_SUSPENDED', mediatorCode } }).catch(() => { });
              writeAuditLog({ req, action: 'ORDERS_FROZEN_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'MEDIATOR_SUSPENDED', mediatorCode } }).catch(() => { });
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
                await db().deal.updateMany({ where: { mediatorCode: { in: mediatorCodes }, deletedAt: null }, data: { active: false } });
                await freezeOrders({ query: { managerName: { in: mediatorCodes } }, reason: 'AGENCY_SUSPENDED', actorUserId: adminPgId });
                writeAuditLog({ req, action: 'DEALS_DEACTIVATED_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'AGENCY_SUSPENDED', agencyCode: mediatorCode, mediatorCount: mediatorCodes.length } }).catch(() => { });
                writeAuditLog({ req, action: 'ORDERS_FROZEN_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'AGENCY_SUSPENDED', agencyCode: mediatorCode, mediatorCount: mediatorCodes.length } }).catch(() => { });
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
              await db().campaign.updateMany({
                where: { brandUserId: user.id, deletedAt: null, status: { in: ['active', 'draft'] as any } },
                data: { status: 'paused' as any },
              });
              await freezeOrders({ query: { brandUserId: user.id }, reason: 'BRAND_SUSPENDED', actorUserId: adminPgId });
              writeAuditLog({ req, action: 'CAMPAIGNS_PAUSED_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'BRAND_SUSPENDED' } }).catch(() => { });
              writeAuditLog({ req, action: 'ORDERS_FROZEN_CASCADE', entityType: 'User', entityId: user.mongoId!, metadata: { reason: 'BRAND_SUSPENDED' } }).catch(() => { });
            }
          }

          if (before.status === 'suspended' && user.status === 'active') {
            await db().suspension.create({
              data: {
                mongoId: randomUUID(),
                targetUserId: user.id,
                action: 'unsuspend' as any,
                reason: body.reason,
                adminUserId: adminPgId!,
              },
            });
            // No auto-unfreeze here by design.
          }
        }

        await writeAuditLog({
          req,
          action: 'USER_STATUS_UPDATED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: { from: before.status, to: user.status, reason: body.reason },
        });
        securityLog.info('User status updated by admin', { userId: user.mongoId, from: before.status, to: user.status, reason: body.reason });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'User', entityId: user.mongoId!, action: 'STATUS_UPDATED', changedFields: ['status'], before: { status: before.status }, after: { status: user.status, reason: body.reason } });

        if (statusChanged) {
          publishRealtime({
            type: 'users.changed',
            ts: new Date().toISOString(),
            payload: { userId: user.mongoId!, status: user.status },
            audience: { roles: ['admin', 'ops'], userIds: [user.mongoId!] },
          });
          const privilegedRoles: Role[] = ['admin', 'ops'];
          const audience = { roles: privilegedRoles, userIds: [user.mongoId!] };
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
        const adminPgId = (req.auth as any)?.pgUserId as string;
        if (!adminPgId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const order = await reactivateOrderWorkflow({ orderId: body.orderId, actorUserId: adminPgId, reason: body.reason });

        await writeAuditLog({
          req,
          action: 'ORDER_REACTIVATED',
          entityType: 'Order',
          entityId: (order as any).mongoId || body.orderId,
          metadata: { reason: body.reason },
        });
        orderLog.info('Order reactivated by admin', { orderId: (order as any).mongoId || body.orderId, reason: body.reason });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Order', entityId: (order as any).mongoId || body.orderId, action: 'ORDER_REACTIVATED', changedFields: ['frozen', 'workflowStatus'], before: { frozen: true }, after: { frozen: false, reason: body.reason } });

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

        const where: any = {};
        if (action && typeof action === 'string') where.action = action;
        if (entityType && typeof entityType === 'string') where.entityType = entityType;
        if (entityId && typeof entityId === 'string') where.entityId = entityId;
        if (actorUserId && typeof actorUserId === 'string') {
          // Support both mongoId and UUID for actorUserId filter
          const isUuid = /^[0-9a-f]{8}-/.test(actorUserId);
          if (isUuid) {
            where.actorUserId = actorUserId;
          } else {
            const actor = await db().user.findFirst({ where: { ...idWhere(actorUserId) }, select: { id: true } });
            if (actor) where.actorUserId = actor.id;
            else where.actorUserId = actorUserId; // fallback
          }
        }

        if (from || to) {
          where.createdAt = {};
          if (from) {
            const d = new Date(from);
            if (!isNaN(d.getTime())) where.createdAt.gte = d;
          }
          if (to) {
            const d = new Date(to);
            if (!isNaN(d.getTime())) where.createdAt.lte = d;
          }
          if (Object.keys(where.createdAt).length === 0) delete where.createdAt;
        }

        const [logs, total] = await Promise.all([
          db().auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
          db().auditLog.count({ where }),
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
