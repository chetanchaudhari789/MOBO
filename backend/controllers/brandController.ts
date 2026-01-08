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

export function makeBrandController() {
  return {
    getAgencies: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, user } = getRequester(req);

        const query: any = { role: 'agency', deletedAt: { $exists: false } };
        if (!isPrivileged(roles)) {
          const connected = Array.isArray((user as any)?.connectedAgencies) ? (user as any).connectedAgencies : [];
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

        const campaigns = await CampaignModel.find({ brandUserId: brandId, deletedAt: { $exists: false } })
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

        const query: any = { deletedAt: { $exists: false } };
        if (isPrivileged(roles)) {
          const brandName = typeof req.query.brandName === 'string' ? req.query.brandName : '';
          if (brandName) query.brandName = brandName;
        } else {
          // Prefer strict brand ownership via brandUserId; fallback to brandName for legacy orders.
          query.$or = [{ brandUserId: userId }, { brandName: (user as any)?.name }];
        }
        const orders = await OrderModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
        res.json(orders.map(toUiOrder));
      } catch (err) {
        next(err);
      }
    },

    getTransactions: async (_req: Request, res: Response) => {
      // Placeholder for UI; payments are modeled via Wallet/Transaction/Payout in backend.
      res.json([]);
    },

    payoutAgency: async (_req: Request, res: Response) => {
      res.json({ ok: true });
    },

    resolveRequest: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = resolveBrandConnectionSchema.parse(req.body);
        const { roles, userId } = getRequester(req);

        const brand = await UserModel.findById(userId);
        if (!brand) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        if (!isPrivileged(roles) && !brand.roles?.includes('brand')) {
          throw new AppError(403, 'FORBIDDEN', 'Only brands can approve requests');
        }

        const agency = await UserModel.findOne({ roles: 'agency', mediatorCode: body.agencyCode, deletedAt: { $exists: false } }).lean();
        if (!agency) throw new AppError(404, 'AGENCY_NOT_FOUND', 'Agency not found');

        const updated = await UserModel.updateOne(
          { _id: brand._id },
          {
            $addToSet: { connectedAgencies: body.agencyCode },
            $pull: { pendingConnections: { agencyCode: body.agencyCode } },
          }
        );
        if (!updated.modifiedCount) {
          throw new AppError(409, 'NO_CHANGE', 'No pending request found');
        }

        await writeAuditLog({
          req,
          action: 'BRAND_CONNECTION_APPROVED',
          entityType: 'User',
          entityId: String(brand._id),
          metadata: { agencyCode: body.agencyCode },
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
        const hasOrders = await OrderModel.exists({ 'items.campaignId': id, deletedAt: { $exists: false } });
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
