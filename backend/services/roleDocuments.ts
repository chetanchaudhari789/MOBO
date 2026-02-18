import type { ClientSession } from 'mongoose';

import { AppError } from '../middleware/errors.js';
import { AgencyModel } from '../models/Agency.js';
import { BrandModel } from '../models/Brand.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { dualWriteAgency, dualWriteBrand, dualWriteMediatorProfile, dualWriteShopperProfile } from './dualWrite.js';

type AnyUser = any;

export async function ensureRoleDocumentsForUser(args: { user: AnyUser; session?: ClientSession }) {
  const user = args.user;
  const roles: string[] = Array.isArray(user?.roles) ? user.roles : [];
  const name = String(user?.name ?? '').trim() || 'User';
  const userId = user?._id;
  if (!userId) throw new AppError(500, 'MISSING_USER_ID', 'Cannot ensure role documents: user is missing _id');

  const createdBy = user?.createdBy;
  const sessionOpt = args.session ? { session: args.session } : undefined;

  if (roles.includes('agency')) {
    const agencyCode = String(user?.mediatorCode ?? '').trim();
    if (!agencyCode) throw new AppError(409, 'MISSING_AGENCY_CODE', 'Agency user is missing a code');

    const agencyDoc = await AgencyModel.findOneAndUpdate(
      { agencyCode },
      {
        $set: {
          name,
          agencyCode,
          ownerUserId: userId,
          status: String(user?.status ?? 'active'),
          updatedBy: user?.updatedBy,
        },
        $setOnInsert: { createdBy },
      },
      { upsert: true, new: true, ...(sessionOpt ?? {}) }
    );
    if (agencyDoc) dualWriteAgency(agencyDoc).catch(() => {});
  }

  if (roles.includes('brand')) {
    const brandCode = String(user?.brandCode ?? '').trim();
    if (!brandCode) throw new AppError(409, 'MISSING_BRAND_CODE', 'Brand user is missing a brandCode');

    const connectedAgencyCodes = Array.isArray(user?.connectedAgencies)
      ? user.connectedAgencies.map((c: unknown) => String(c ?? '').trim()).filter(Boolean)
      : [];

    const brandDoc = await BrandModel.findOneAndUpdate(
      { brandCode },
      {
        $set: {
          name,
          brandCode,
          ownerUserId: userId,
          status: String(user?.status ?? 'active'),
          connectedAgencyCodes,
          updatedBy: user?.updatedBy,
        },
        $setOnInsert: { createdBy },
      },
      { upsert: true, new: true, ...(sessionOpt ?? {}) }
    );
    if (brandDoc) dualWriteBrand(brandDoc).catch(() => {});
  }

  if (roles.includes('mediator')) {
    const mediatorCode = String(user?.mediatorCode ?? '').trim();
    if (!mediatorCode) throw new AppError(409, 'MISSING_MEDIATOR_CODE', 'Mediator user is missing a code');

    const mediatorDoc = await MediatorProfileModel.findOneAndUpdate(
      { mediatorCode },
      {
        $set: {
          userId,
          mediatorCode,
          parentAgencyCode: String(user?.parentCode ?? '').trim() || undefined,
          status: String(user?.status ?? 'active'),
          updatedBy: user?.updatedBy,
        },
        $setOnInsert: { createdBy },
      },
      { upsert: true, new: true, ...(sessionOpt ?? {}) }
    );
    if (mediatorDoc) dualWriteMediatorProfile(mediatorDoc).catch(() => {});
  }

  if (roles.includes('shopper')) {
    const shopperDoc = await ShopperProfileModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          defaultMediatorCode: String(user?.parentCode ?? '').trim() || undefined,
          updatedBy: user?.updatedBy,
        },
        $setOnInsert: { createdBy },
      },
      { upsert: true, new: true, ...(sessionOpt ?? {}) }
    );
    if (shopperDoc) dualWriteShopperProfile(shopperDoc).catch(() => {});
  }
}
