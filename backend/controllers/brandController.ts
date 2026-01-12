import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { CampaignModel } from '../models/Campaign.js';
import { OrderModel } from '../models/Order.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiCampaign, toUiOrder, toUiOrderForBrand, toUiUser } from '../utils/uiMappers.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { writeAuditLog } from '../services/audit.js';
import { removeBrandConnectionSchema, resolveBrandConnectionSchema } from '../validations/connections.js';
import { payoutAgencySchema } from '../validations/brand.js';
import { TransactionModel } from '../models/Transaction.js';
import { ensureWallet, applyWalletCredit, applyWalletDebit } from '../services/walletService.js';
import { publishBroadcast, publishRealtime } from '../services/realtimeHub.js';

async function recordManualPayoutLedger(args: {
  idempotencyKey: string;
  brandId: string;
  agencyId: string;
  amountPaise: number;
  ref: string;
  agencyCode: string;
  agencyName: string;
  brandName: string;
}) {
  // Create an immutable ledger record even when wallets are not funded.
  // This supports "manual" real-world transfers while still keeping an audit trail.
  const existing = await TransactionModel.findOne({ idempotencyKey: args.idempotencyKey, deletedAt: null }).lean();
  if (!existing) {
    await TransactionModel.create({
      idempotencyKey: args.idempotencyKey,
      type: 'agency_payout',
      status: 'completed',
      amountPaise: args.amountPaise,
      currency: 'INR',
      fromUserId: args.brandId as any,
      toUserId: args.agencyId as any,
      metadata: {
        ref: args.ref,
        agencyId: args.agencyId,
        agencyCode: args.agencyCode,
        agencyName: args.agencyName,
        brandId: args.brandId,
        brandName: args.brandName,
        mode: 'manual',
      },
    } as any);
  }

  const creditKey = `${args.idempotencyKey}:credit`;
  const existingCredit = await TransactionModel.findOne({ idempotencyKey: creditKey, deletedAt: null }).lean();
  if (!existingCredit) {
    await TransactionModel.create({
      idempotencyKey: creditKey,
      type: 'agency_receipt',
      status: 'completed',
      amountPaise: args.amountPaise,
      currency: 'INR',
      fromUserId: args.brandId as any,
      toUserId: args.agencyId as any,
      metadata: {
        ref: args.ref,
        agencyId: args.agencyId,
        agencyCode: args.agencyCode,
        agencyName: args.agencyName,
        brandId: args.brandId,
        brandName: args.brandName,
        mode: 'manual',
      },
    } as any);
  }
}

export function makeBrandController() {
  return {
    getAgencies: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId } = getRequester(req);

        const query: any = { role: 'agency', deletedAt: null };
        if (!isPrivileged(roles)) {
          const brand = await UserModel.findById(userId).select({ connectedAgencies: 1 }).lean();
          const connected = Array.isArray((brand as any)?.connectedAgencies)
            ? (brand as any).connectedAgencies
            : [];
          query.mediatorCode = { $in: connected };
        }

        const agencies = await UserModel.find(query).sort({ createdAt: -1 }).lean();
        res.json(agencies.map((a) => toUiUser(a, null)));
      } catch (err) {
        next(err);
      }
    },

    getCampaigns: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId } = getRequester(req);
        const requested = typeof req.query.brandId === 'string' ? req.query.brandId : '';
        const brandId = isPrivileged(roles) && requested ? requested : userId;

        const campaigns = await CampaignModel.find({ brandUserId: brandId, deletedAt: null })
          .sort({ createdAt: -1 })
          .lean();
        res.json(campaigns.map(toUiCampaign));
      } catch (err) {
        next(err);
      }
    },

    getOrders: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId, user } = getRequester(req);

        const query: any = { deletedAt: null };
        if (isPrivileged(roles)) {
          const brandName = typeof req.query.brandName === 'string' ? req.query.brandName : '';
          if (brandName) query.brandName = brandName;
        } else {
          // Prefer strict brand ownership via brandUserId; fallback to brandName for legacy orders.
          query.$or = [
            { brandUserId: userId },
            // Legacy: only match by brandName when the order predates brandUserId.
            { brandUserId: { $in: [null, undefined] }, brandName: (user as any)?.name },
          ];
        }
        const orders = await OrderModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        // Brands must not see buyer PII or proof artifacts.
        if (!isPrivileged(roles) && roles.includes('brand')) {
          res.json(orders.map(toUiOrderForBrand));
          return;
        }

        res.json(orders.map(toUiOrder));
      } catch (err) {
        next(err);
      }
    },

    getTransactions: async (_req: Request, res: Response) => {
      try {
        const { roles, userId } = getRequester(_req);
        const requested = typeof (_req.query as any).brandId === 'string' ? String((_req.query as any).brandId) : '';
        const brandId = isPrivileged(roles) && requested ? requested : userId;

        // Brand ledger = outbound agency payouts from this brand.
        const txns = await TransactionModel.find({
          deletedAt: null,
          fromUserId: brandId as any,
          type: 'agency_payout',
        })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();

        const agencyIds = Array.from(
          new Set(
            txns
              .map((t: any) => String(t.toUserId || ''))
              .filter(Boolean)
          )
        );

        const agencies = agencyIds.length
            ? await UserModel.find({ _id: { $in: agencyIds as any }, deletedAt: null })
              .select({ name: 1, mediatorCode: 1 })
              .lean()
          : [];
        const byId = new Map(agencies.map((a: any) => [String(a._id), a]));

        res.json(
          txns.map((t: any) => {
            const agency = t.toUserId ? byId.get(String(t.toUserId)) : undefined;
            const meta = (t.metadata && typeof t.metadata === 'object') ? (t.metadata as any) : {};
            return {
              id: String(t._id),
              date: (t.createdAt ?? new Date()).toISOString(),
              agencyName: String(meta.agencyName || agency?.name || 'Agency'),
              amount: Math.round(Number(t.amountPaise ?? 0) / 100),
              ref: String(meta.ref || ''),
              status: t.status === 'completed' ? 'Success' : String(t.status),
            };
          })
        );
      } catch {
        // Keep UI resilient: ledger isn't critical for core flows.
        res.json([]);
      }
    },

    payoutAgency: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = payoutAgencySchema.parse(req.body);
        const { roles, userId, user } = getRequester(req);

        const brandId = isPrivileged(roles) && body.brandId ? String(body.brandId) : userId;

        const brand = await UserModel.findById(brandId).select({ roles: 1, connectedAgencies: 1, name: 1, status: 1, deletedAt: 1 }).lean();
        if (!brand || (brand as any).deletedAt) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        if (!isPrivileged(roles) && !(brand as any).roles?.includes('brand')) {
          throw new AppError(403, 'FORBIDDEN', 'Only brands can record payouts');
        }
        if (String((brand as any).status || '') !== 'active') {
          throw new AppError(409, 'BRAND_NOT_ACTIVE', 'Brand is not active');
        }

        const agency = await UserModel.findById(body.agencyId).select({ roles: 1, mediatorCode: 1, name: 1, status: 1, deletedAt: 1 }).lean();
        if (!agency || (agency as any).deletedAt) throw new AppError(404, 'AGENCY_NOT_FOUND', 'Agency not found');
        if (!(agency as any).roles?.includes('agency')) throw new AppError(404, 'AGENCY_NOT_FOUND', 'Agency not found');
        if (String((agency as any).status || '') !== 'active') throw new AppError(409, 'AGENCY_NOT_ACTIVE', 'Agency is not active');

        const agencyCode = String((agency as any).mediatorCode || '').trim();
        if (!agencyCode) throw new AppError(409, 'AGENCY_MISSING_CODE', 'Agency is missing a code');

        if (!isPrivileged(roles)) {
          const connected = Array.isArray((user as any)?.connectedAgencies)
            ? ((user as any).connectedAgencies as string[])
            : Array.isArray((brand as any)?.connectedAgencies)
              ? ((brand as any).connectedAgencies as string[])
              : [];
          if (!connected.includes(agencyCode)) {
            throw new AppError(403, 'FORBIDDEN', 'Agency is not connected to this brand');
          }
        }

        const amountPaise = rupeesToPaise(Number(body.amount));
        const ref = String(body.ref).trim();

        // Ensure wallets exist.
        await Promise.all([ensureWallet(String(brandId)), ensureWallet(String(body.agencyId))]);

        // Idempotent payout: double-click safe.
        const idKey = `brand_agency_payout:${brandId}:${body.agencyId}:${ref}`;

        const brandName = String((brand as any).name || 'Brand');
        const agencyName = String((agency as any).name || 'Agency');

        // Preferred: wallet-backed payout (enforces sufficient balance).
        // Fallback: if wallet is not funded, still record a completed manual ledger entry
        // so the brand can track real-world transfers.
        try {
          // Debit brand first (fails if insufficient funds).
          await applyWalletDebit({
            idempotencyKey: idKey,
            type: 'agency_payout',
            ownerUserId: String(brandId),
            fromUserId: String(brandId),
            toUserId: String(body.agencyId),
            amountPaise,
            metadata: { ref, agencyId: String(body.agencyId), agencyCode, agencyName },
          });

          // Credit agency (separate idempotency key to keep both sides independently replay-safe).
          await applyWalletCredit({
            idempotencyKey: `${idKey}:credit`,
            type: 'agency_receipt',
            ownerUserId: String(body.agencyId),
            fromUserId: String(brandId),
            toUserId: String(body.agencyId),
            amountPaise,
            metadata: { ref, brandId: String(brandId), brandName },
          });
        } catch (e: any) {
          const code = String(e?.code || e?.error?.code || '');
          if (code !== 'INSUFFICIENT_FUNDS' && code !== 'WALLET_NOT_FOUND') throw e;
          await recordManualPayoutLedger({
            idempotencyKey: idKey,
            brandId: String(brandId),
            agencyId: String(body.agencyId),
            amountPaise,
            ref,
            agencyCode,
            agencyName,
            brandName,
          });
        }

        await writeAuditLog({
          req,
          action: 'BRAND_AGENCY_PAYOUT_RECORDED',
          entityType: 'User',
          entityId: String(brandId),
          metadata: { agencyId: String(body.agencyId), agencyCode, amountPaise, ref },
        });

        publishBroadcast('wallets.changed', { brandId: String(brandId), agencyId: String(body.agencyId) });
        publishBroadcast('notifications.changed');

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    resolveRequest: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = resolveBrandConnectionSchema.parse(req.body);
        const { roles, userId } = getRequester(req);

        let agency: any | null = null;
        if (body.agencyId) {
          agency = await UserModel.findOne({
            _id: body.agencyId,
            roles: 'agency',
            deletedAt: null,
          })
            .select({ _id: 1, mediatorCode: 1 })
            .lean();
        } else if (body.agencyCode) {
          agency = await UserModel.findOne({ roles: 'agency', mediatorCode: body.agencyCode, deletedAt: null })
            .select({ _id: 1, mediatorCode: 1 })
            .lean();
        }

        if (!agency) throw new AppError(404, 'AGENCY_NOT_FOUND', 'Agency not found');

        const agencyCode = String((agency as any).mediatorCode || '').trim();
        if (!agencyCode) throw new AppError(409, 'AGENCY_MISSING_CODE', 'Agency is missing a code');

        const brand = await UserModel.findById(userId);
        if (!brand) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        if (!isPrivileged(roles) && !brand.roles?.includes('brand')) {
          throw new AppError(403, 'FORBIDDEN', 'Only brands can approve requests');
        }

        const update: any = {
          // Be robust: historical data may have either agencyCode formatting differences or only agencyId.
          $pull: {
            pendingConnections: {
              $or: [{ agencyCode }, { agencyId: String((agency as any)?._id) }],
            },
          },
        };
        if (body.action === 'approve') {
          update.$addToSet = { connectedAgencies: agencyCode };
        }

        const updated = await UserModel.updateOne({ _id: brand._id }, update);
        if (!updated.modifiedCount) {
          throw new AppError(409, 'NO_CHANGE', 'No pending request found');
        }

        await writeAuditLog({
          req,
          action: body.action === 'approve' ? 'BRAND_CONNECTION_APPROVED' : 'BRAND_CONNECTION_REJECTED',
          entityType: 'User',
          entityId: String(brand._id),
          metadata: { agencyCode },
        });

        // Realtime: update both sides' UI state (scoped).
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { brandId: String(brand._id), agencyCode, action: body.action },
          audience: {
            userIds: [String(brand._id)],
            agencyCodes: [agencyCode],
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'brand.connection.resolved', agencyCode, action: body.action },
          audience: {
            userIds: [String(brand._id)],
            agencyCodes: [agencyCode],
            roles: ['admin', 'ops'],
          },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    removeAgency: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = removeBrandConnectionSchema.parse(req.body);
        const { roles, userId } = getRequester(req);

        const brand = await UserModel.findById(userId);
        if (!brand) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        if (!isPrivileged(roles) && !brand.roles?.includes('brand')) {
          throw new AppError(403, 'FORBIDDEN', 'Only brands can remove agencies');
        }

        const updated = await UserModel.updateOne(
          { _id: brand._id },
          {
            $pull: {
              connectedAgencies: body.agencyCode,
              pendingConnections: { agencyCode: body.agencyCode },
            },
          }
        );
        if (!updated.modifiedCount) {
          throw new AppError(404, 'NOT_FOUND', 'Agency connection not found');
        }

        await writeAuditLog({
          req,
          action: 'BRAND_CONNECTION_REMOVED',
          entityType: 'User',
          entityId: String(brand._id),
          metadata: { agencyCode: body.agencyCode },
        });

        // Realtime: update both brand + removed agency UIs.
        const agencyCode = String(body.agencyCode || '').trim();
        const ts = new Date().toISOString();
        publishRealtime({
          type: 'users.changed',
          ts,
          payload: { brandId: String(brand._id), agencyCode, action: 'removed' },
          audience: {
            userIds: [String(brand._id)],
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'brand.connection.removed', agencyCode },
          audience: {
            userIds: [String(brand._id)],
            ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
            roles: ['admin', 'ops'],
          },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    createCampaign: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId, user } = getRequester(req);
        const body = req.body as any;

        const brandId = isPrivileged(roles) && body?.brandId ? String(body.brandId) : userId;

        // Brand must explicitly assign campaigns to specific connected agencies.
        const allowed = Array.isArray(body.allowedAgencies) ? body.allowedAgencies : [];
        if (!allowed.length) {
          throw new AppError(400, 'INVALID_ALLOWED_AGENCIES', 'allowedAgencies is required');
        }

        const normalizedAllowed = allowed.map((c: any) => String(c).trim()).filter(Boolean);
        const agencies = await UserModel.find({
          mediatorCode: { $in: normalizedAllowed },
          roles: 'agency',
          status: 'active',
          deletedAt: null,
        })
          .select({ mediatorCode: 1 })
          .lean();
        const found = new Set(agencies.map((a: any) => String(a.mediatorCode)));
        const missing = normalizedAllowed.filter((c: string) => !found.has(c));
        if (missing.length) {
          throw new AppError(400, 'INVALID_ALLOWED_AGENCIES', `Invalid agency codes: ${missing.join(', ')}`);
        }

        if (!isPrivileged(roles)) {
          // Auto-connect allowed agencies to the brand to remove friction.
          await UserModel.updateOne(
            { _id: userId as any },
            { $addToSet: { connectedAgencies: { $each: normalizedAllowed } } }
          );
        }

        const campaign = await CampaignModel.create({
          title: body.title,
          brandUserId: brandId,
          brandName: isPrivileged(roles) ? (body.brand ?? 'Brand') : String((user as any)?.name || 'Brand'),
          platform: body.platform,
          image: body.image,
          productUrl: body.productUrl,
          originalPricePaise: rupeesToPaise(Number(body.originalPrice ?? 0)),
          pricePaise: rupeesToPaise(Number(body.price ?? 0)),
          payoutPaise: rupeesToPaise(Number(body.payout ?? 0)),
          totalSlots: Number(body.totalSlots ?? 0),
          usedSlots: 0,
          status: 'active',
          allowedAgencyCodes: normalizedAllowed,
          dealType: body.dealType,
          returnWindowDays: Number(body.returnWindowDays ?? 14),
        });

        const ts = new Date().toISOString();
        publishRealtime({
          type: 'deals.changed',
          ts,
          payload: { campaignId: String((campaign as any)._id), brandId: String(brandId) },
          audience: {
            userIds: [String(brandId)],
            agencyCodes: normalizedAllowed,
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'campaign.created', campaignId: String((campaign as any)._id) },
          audience: {
            userIds: [String(brandId)],
            agencyCodes: normalizedAllowed,
            roles: ['admin', 'ops'],
          },
        });

        res.status(201).json(toUiCampaign(campaign.toObject()));
      } catch (err) {
        next(err);
      }
    },

    updateCampaign: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.campaignId || '');
        if (!id) throw new AppError(400, 'INVALID_CAMPAIGN_ID', 'campaignId required');

        const { roles, userId, user } = getRequester(req);
        let previousAllowed: string[] = [];
        let previousBrandUserId: string | null = null;
        if (!isPrivileged(roles)) {
          const existing = await CampaignModel.findById(id)
            .select({ brandUserId: 1, brandName: 1, allowedAgencyCodes: 1 })
            .lean();
          if (!existing) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
          const ok = String((existing as any).brandUserId || '') === String(userId);
          if (!ok) throw new AppError(403, 'FORBIDDEN', 'Cannot modify campaigns outside your brand');

          previousBrandUserId = String((existing as any).brandUserId || '') || null;
          previousAllowed = Array.isArray((existing as any).allowedAgencyCodes)
            ? (existing as any).allowedAgencyCodes.map((c: any) => String(c).trim()).filter(Boolean)
            : [];

          if (typeof (req.body as any)?.allowedAgencies !== 'undefined') {
            const allowed = Array.isArray((req.body as any).allowedAgencies) ? (req.body as any).allowedAgencies : [];
            const normalizedAllowed = allowed.map((c: any) => String(c).trim()).filter(Boolean);
            const agencies = await UserModel.find({
              mediatorCode: { $in: normalizedAllowed },
              roles: 'agency',
              status: 'active',
              deletedAt: null,
            })
              .select({ mediatorCode: 1 })
              .lean();
            const found = new Set(agencies.map((a: any) => String(a.mediatorCode)));
            const missing = normalizedAllowed.filter((c: string) => !found.has(c));
            if (missing.length) {
              throw new AppError(400, 'INVALID_ALLOWED_AGENCIES', `Invalid agency codes: ${missing.join(', ')}`);
            }

            // Auto-connect newly assigned agencies.
            await UserModel.updateOne(
              { _id: userId as any },
              { $addToSet: { connectedAgencies: { $each: normalizedAllowed } } }
            );
          }
        }

        const body = req.body as any;

        // Non-negotiable: lock campaign mutability after the first order is created.
        const hasOrders = await OrderModel.exists({ 'items.campaignId': id, deletedAt: null });
        const requestedKeys = Object.keys(body || {});
        const onlyStatus = requestedKeys.length === 1 && requestedKeys[0] === 'status';
        
        // CRITICAL: Also check if campaign is locked via slot assignment
        const campaignCheck = await CampaignModel.findById(id).select({ locked: 1 }).lean();
        if ((campaignCheck as any)?.locked && !onlyStatus) {
          throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is locked after slot assignment; create a new campaign to change terms');
        }
        
        if (hasOrders && !onlyStatus) {
          throw new AppError(409, 'CAMPAIGN_LOCKED', 'Campaign is locked after first order; create a new campaign to change terms');
        }

        const update: any = {};
        for (const key of ['title', 'platform', 'image', 'productUrl', 'dealType'] as const) {
          if (typeof body[key] !== 'undefined') update[key] = body[key];
        }
        if (typeof body.status !== 'undefined') update.status = String(body.status).toLowerCase();
        if (typeof body.price !== 'undefined') update.pricePaise = rupeesToPaise(Number(body.price));
        if (typeof body.originalPrice !== 'undefined')
          update.originalPricePaise = rupeesToPaise(Number(body.originalPrice));
        if (typeof body.payout !== 'undefined') update.payoutPaise = rupeesToPaise(Number(body.payout));
        if (typeof body.totalSlots !== 'undefined') update.totalSlots = Number(body.totalSlots);
        if (typeof body.allowedAgencies !== 'undefined') update.allowedAgencyCodes = body.allowedAgencies;

        const campaign = await CampaignModel.findByIdAndUpdate(id, update, { new: true });
        if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');

        const nextAllowed = Array.isArray((campaign as any).allowedAgencyCodes)
          ? (campaign as any).allowedAgencyCodes.map((c: any) => String(c).trim()).filter(Boolean)
          : [];

        // Notify both newly-added AND removed agencies so their UIs update instantly.
        const allowedUnion = Array.from(new Set([...(previousAllowed || []), ...(nextAllowed || [])])).filter(Boolean);
        const brandUserIdForAudience = String((campaign as any).brandUserId || previousBrandUserId || userId);

        const ts = new Date().toISOString();
        publishRealtime({
          type: 'deals.changed',
          ts,
          payload: { campaignId: String((campaign as any)._id) },
          audience: {
            userIds: [brandUserIdForAudience],
            agencyCodes: allowedUnion,
            roles: ['admin', 'ops'],
          },
        });
        publishRealtime({
          type: 'notifications.changed',
          ts,
          payload: { source: 'campaign.updated', campaignId: String((campaign as any)._id) },
          audience: {
            userIds: [brandUserIdForAudience],
            agencyCodes: allowedUnion,
            roles: ['admin', 'ops'],
          },
        });

        res.json(toUiCampaign(campaign.toObject()));
      } catch (err) {
        next(err);
      }
    },
  };
}
