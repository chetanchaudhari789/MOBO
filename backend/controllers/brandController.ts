import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { CampaignModel } from '../models/Campaign.js';
import { OrderModel } from '../models/Order.js';
import { rupeesToPaise } from '../utils/money.js';
import { toUiCampaign, toUiOrder, toUiUser } from '../utils/uiMappers.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { writeAuditLog } from '../services/audit.js';
import { removeBrandConnectionSchema, resolveBrandConnectionSchema } from '../validations/connections.js';
import { payoutAgencySchema } from '../validations/brand.js';
import { TransactionModel } from '../models/Transaction.js';
import { ensureWallet, applyWalletCredit, applyWalletDebit } from '../services/walletService.js';

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

        // Debit brand first (fails if insufficient funds).
        await applyWalletDebit({
          idempotencyKey: idKey,
          type: 'agency_payout',
          ownerUserId: String(brandId),
          fromUserId: String(brandId),
          toUserId: String(body.agencyId),
          amountPaise,
          metadata: { ref, agencyId: String(body.agencyId), agencyCode, agencyName: String((agency as any).name || 'Agency') },
        });

        // Credit agency (separate idempotency key to keep both sides independently replay-safe).
        await applyWalletCredit({
          idempotencyKey: `${idKey}:credit`,
          type: 'agency_receipt',
          ownerUserId: String(body.agencyId),
          fromUserId: String(brandId),
          toUserId: String(body.agencyId),
          amountPaise,
          metadata: { ref, brandId: String(brandId), brandName: String((brand as any).name || 'Brand') },
        });

        await writeAuditLog({
          req,
          action: 'BRAND_AGENCY_PAYOUT_RECORDED',
          entityType: 'User',
          entityId: String(brandId),
          metadata: { agencyId: String(body.agencyId), agencyCode, amountPaise, ref },
        });

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

        if (!isPrivileged(roles)) {
          const connected = Array.isArray((user as any)?.connectedAgencies) ? (user as any).connectedAgencies : [];
          const allConnected = allowed.every((c: any) => connected.includes(String(c)));
          if (!allConnected) {
            throw new AppError(403, 'FORBIDDEN', 'Campaign can only be assigned to connected agencies');
          }
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
          allowedAgencyCodes: allowed,
          dealType: body.dealType,
          returnWindowDays: Number(body.returnWindowDays ?? 14),
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
        if (!isPrivileged(roles)) {
          const existing = await CampaignModel.findById(id).select({ brandUserId: 1, brandName: 1 }).lean();
          if (!existing) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
          const ok = String((existing as any).brandUserId || '') === String(userId);
          if (!ok) throw new AppError(403, 'FORBIDDEN', 'Cannot modify campaigns outside your brand');

          if (typeof (req.body as any)?.allowedAgencies !== 'undefined') {
            const allowed = Array.isArray((req.body as any).allowedAgencies) ? (req.body as any).allowedAgencies : [];
            const connected = Array.isArray((user as any)?.connectedAgencies) ? (user as any).connectedAgencies : [];
            const allConnected = allowed.every((c: any) => connected.includes(String(c)));
            if (!allConnected) {
              throw new AppError(403, 'FORBIDDEN', 'Campaign can only be assigned to connected agencies');
            }
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
        res.json(toUiCampaign(campaign.toObject()));
      } catch (err) {
        next(err);
      }
    },
  };
}
