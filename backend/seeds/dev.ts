import mongoose from 'mongoose';

import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';

import { hashPassword } from '../services/passwords.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { seedAdminOnly } from './admin.js';

export const DEV_ACCOUNTS = {
  admin: {
    name: 'Dev Admin',
    username: 'root',
    password: 'ChangeMe_123!',
    mobile: '9000000000',
  },
  agency: {
    name: 'Dev Agency',
    password: 'ChangeMe_123!',
    mobile: '9000000001',
    agencyCode: 'AG_TEST',
  },
  mediator: {
    name: 'Dev Mediator',
    password: 'ChangeMe_123!',
    mobile: '9000000002',
    mediatorCode: 'MED_TEST',
  },
  brand: {
    name: 'Dev Brand',
    password: 'ChangeMe_123!',
    mobile: '9000000003',
    brandCode: 'BRD_TEST',
  },
  shopper: {
    name: 'Dev Buyer',
    password: 'ChangeMe_123!',
    mobile: '9000000004',
  },
} as const;

export type SeededDev = {
  admin: any;
  agency: any;
  mediator: any;
  brand: any;
  shopper: any;
  campaign: any;
  deal: any;
};

async function upsertUserByMobile(params: {
  mobile: string;
  name: string;
  password: string;
  role: 'agency' | 'mediator' | 'brand' | 'shopper';
  roles: string[];
  mutate: (u: any) => void;
}) {
  const forcePassword = String(process.env.SEED_DEV_FORCE_PASSWORD || '').toLowerCase() === 'true';

  let user = await UserModel.findOne({ mobile: params.mobile, deletedAt: null });
  if (!user) {
    const passwordHash = await hashPassword(params.password);
    user = new UserModel({
      name: params.name,
      mobile: params.mobile,
      passwordHash,
      role: params.role,
      roles: params.roles,
      status: 'active',
      deletedAt: null,
    });
  } else {
    user.name = params.name;
    (user as any).role = params.role;
    (user as any).roles = Array.from(new Set([...(user as any).roles ?? [], ...params.roles]));
    (user as any).status = 'active';
    (user as any).deletedAt = null;

    if (forcePassword) {
      user.passwordHash = await hashPassword(params.password);
    }
  }

  params.mutate(user);
  await user.save();
  return user;
}

async function ensureBrandWalletFunds(brandUserId: any) {
  const target = 50_000_00; // ₹50,000
  const wallet = await WalletModel.findOneAndUpdate(
    { ownerUserId: brandUserId, deletedAt: null },
    {
      $setOnInsert: {
        ownerUserId: brandUserId,
        currency: 'INR',
      },
    },
    { upsert: true, new: true }
  );

  const available = Number((wallet as any).availablePaise ?? 0);
  if (available < target) {
    (wallet as any).availablePaise = target;
    (wallet as any).pendingPaise = Number((wallet as any).pendingPaise ?? 0);
    (wallet as any).lockedPaise = Number((wallet as any).lockedPaise ?? 0);
    await (wallet as any).save();
  }
}

export async function seedDev(): Promise<SeededDev> {
  if (mongoose.connection.readyState === 0) {
    throw new Error('seedDev() requires an active Mongo connection');
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('seedDev() is disabled in production');
  }

  const admin = await seedAdminOnly({
    username: DEV_ACCOUNTS.admin.username,
    mobile: DEV_ACCOUNTS.admin.mobile,
    password: DEV_ACCOUNTS.admin.password,
    name: DEV_ACCOUNTS.admin.name,
    forcePassword: String(process.env.SEED_DEV_FORCE_PASSWORD || '').toLowerCase() === 'true',
    forceUsername: true,
  });

  const agency = await upsertUserByMobile({
    mobile: DEV_ACCOUNTS.agency.mobile,
    name: DEV_ACCOUNTS.agency.name,
    password: DEV_ACCOUNTS.agency.password,
    role: 'agency',
    roles: ['agency'],
    mutate: (u) => {
      // For agencies, the system stores the agency code in legacy `mediatorCode`.
      u.mediatorCode = DEV_ACCOUNTS.agency.agencyCode;
      u.kycStatus = u.kycStatus ?? 'verified';
      u.createdBy = u.createdBy ?? admin._id;
    },
  });

  const mediator = await upsertUserByMobile({
    mobile: DEV_ACCOUNTS.mediator.mobile,
    name: DEV_ACCOUNTS.mediator.name,
    password: DEV_ACCOUNTS.mediator.password,
    role: 'mediator',
    roles: ['mediator'],
    mutate: (u) => {
      u.mediatorCode = DEV_ACCOUNTS.mediator.mediatorCode;
      u.parentCode = DEV_ACCOUNTS.agency.agencyCode;
      u.kycStatus = u.kycStatus ?? 'verified';
      u.createdBy = u.createdBy ?? admin._id;
    },
  });

  const brand = await upsertUserByMobile({
    mobile: DEV_ACCOUNTS.brand.mobile,
    name: DEV_ACCOUNTS.brand.name,
    password: DEV_ACCOUNTS.brand.password,
    role: 'brand',
    roles: ['brand'],
    mutate: (u) => {
      u.brandCode = DEV_ACCOUNTS.brand.brandCode;
      u.createdBy = u.createdBy ?? admin._id;
    },
  });

  const shopper = await upsertUserByMobile({
    mobile: DEV_ACCOUNTS.shopper.mobile,
    name: DEV_ACCOUNTS.shopper.name,
    password: DEV_ACCOUNTS.shopper.password,
    role: 'shopper',
    roles: ['shopper'],
    mutate: (u) => {
      u.isVerifiedByMediator = true;
      u.parentCode = DEV_ACCOUNTS.mediator.mediatorCode;
      u.createdBy = u.createdBy ?? admin._id;
    },
  });

  await ensureRoleDocumentsForUser({ user: agency });
  await ensureRoleDocumentsForUser({ user: mediator });
  await ensureRoleDocumentsForUser({ user: brand });
  await ensureRoleDocumentsForUser({ user: shopper });

  await ensureBrandWalletFunds(brand._id);

  // Minimal campaign + deal so Buyer portal has something to browse.
  const campaignTitle = 'DEV Campaign';
  const campaign =
    (await CampaignModel.findOne({ title: campaignTitle, brandUserId: brand._id }).lean()) ??
    (await CampaignModel.create({
      title: campaignTitle,
      brandUserId: brand._id,
      brandName: DEV_ACCOUNTS.brand.name,
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 1200_00,
      pricePaise: 999_00,
      payoutPaise: 100_00,
      returnWindowDays: 14,
      dealType: 'Discount',
      totalSlots: 100,
      usedSlots: 0,
      status: 'active',
      allowedAgencyCodes: [DEV_ACCOUNTS.agency.agencyCode],
      assignments: {
        [DEV_ACCOUNTS.mediator.mediatorCode]: { limit: 100 },
      },
      createdBy: admin._id,
    }));

  const dealTitle = 'DEV Deal';
  const existingDeal = await DealModel.findOne({ title: dealTitle, mediatorCode: DEV_ACCOUNTS.mediator.mediatorCode }).lean();
  const deal =
    existingDeal ??
    (await DealModel.create({
      campaignId: (campaign as any)._id,
      mediatorCode: DEV_ACCOUNTS.mediator.mediatorCode,
      title: dealTitle,
      description: 'Seeded demo deal',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      platform: 'Amazon',
      brandName: DEV_ACCOUNTS.brand.name,
      dealType: 'Discount',
      originalPricePaise: 1200_00,
      pricePaise: 999_00,
      commissionPaise: 50_00,
      payoutPaise: 100_00,
      rating: 5,
      category: 'General',
      active: true,
      createdBy: admin._id,
    }));

  return { admin, agency, mediator, brand, shopper, campaign, deal };
}
