import mongoose from 'mongoose';

import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { AgencyModel } from '../models/Agency.js';
import { BrandModel } from '../models/Brand.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import { TicketModel } from '../models/Ticket.js';
import { InviteModel } from '../models/Invite.js';
import { TransactionModel } from '../models/Transaction.js';
import { PayoutModel } from '../models/Payout.js';

import { hashPassword } from '../services/passwords.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';

export const E2E_ACCOUNTS = {
  admin: {
    name: 'E2E Admin',
    username: 'root',
    password: 'ChangeMe_123!',
    mobile: '9000000000',
  },
  agency: {
    name: 'E2E Agency',
    password: 'ChangeMe_123!',
    mobile: '9000000001',
    agencyCode: 'AG_TEST',
  },
  mediator: {
    name: 'E2E Mediator',
    password: 'ChangeMe_123!',
    mobile: '9000000002',
    mediatorCode: 'MED_TEST',
  },
  brand: {
    name: 'E2E Brand',
    password: 'ChangeMe_123!',
    mobile: '9000000003',
    brandCode: 'BRD_TEST',
  },
  shopper: {
    name: 'E2E Shopper',
    password: 'ChangeMe_123!',
    mobile: '9000000004',
  },
  shopper2: {
    name: 'E2E Shopper 2',
    password: 'ChangeMe_123!',
    mobile: '9000000005',
  },
} as const;

export type SeededE2E = {
  admin: any;
  agency: any;
  mediator: any;
  brand: any;
  shopper: any;
  shopper2: any;
};

async function wipeCollections() {
  const deletions: Array<Promise<unknown>> = [];

  // Only wipe the collections that the backend tests touch.
  // Note: deletion order doesn't matter in Mongo (no FK constraints).
  deletions.push(UserModel.deleteMany({}));
  deletions.push(WalletModel.deleteMany({}));
  deletions.push(AgencyModel.deleteMany({}));
  deletions.push(BrandModel.deleteMany({}));
  deletions.push(MediatorProfileModel.deleteMany({}));
  deletions.push(ShopperProfileModel.deleteMany({}));
  deletions.push(CampaignModel.deleteMany({}));
  deletions.push(DealModel.deleteMany({}));
  deletions.push(OrderModel.deleteMany({}));
  deletions.push(TicketModel.deleteMany({}));
  deletions.push(InviteModel.deleteMany({}));
  deletions.push(TransactionModel.deleteMany({}));
  deletions.push(PayoutModel.deleteMany({}));

  await Promise.allSettled(deletions);
}

export async function seedE2E(): Promise<SeededE2E> {
  if (mongoose.connection.readyState === 0) {
    throw new Error('seedE2E() requires an active Mongo connection');
  }

  await wipeCollections();

  const adminPasswordHash = await hashPassword(E2E_ACCOUNTS.admin.password);
  const admin = await UserModel.create({
    name: E2E_ACCOUNTS.admin.name,
    mobile: E2E_ACCOUNTS.admin.mobile,
    username: E2E_ACCOUNTS.admin.username,
    passwordHash: adminPasswordHash,
    role: 'admin',
    roles: ['admin', 'ops'],
    status: 'active',
  });

  const agencyPasswordHash = await hashPassword(E2E_ACCOUNTS.agency.password);
  const agency = await UserModel.create({
    name: E2E_ACCOUNTS.agency.name,
    mobile: E2E_ACCOUNTS.agency.mobile,
    passwordHash: agencyPasswordHash,
    role: 'agency',
    roles: ['agency'],
    status: 'active',

    // For agencies, the system stores the agency code in the legacy `mediatorCode` field.
    mediatorCode: E2E_ACCOUNTS.agency.agencyCode,

    createdBy: admin._id,
  });

  const mediatorPasswordHash = await hashPassword(E2E_ACCOUNTS.mediator.password);
  const mediator = await UserModel.create({
    name: E2E_ACCOUNTS.mediator.name,
    mobile: E2E_ACCOUNTS.mediator.mobile,
    passwordHash: mediatorPasswordHash,
    role: 'mediator',
    roles: ['mediator'],
    status: 'active',

    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    parentCode: E2E_ACCOUNTS.agency.agencyCode,

    createdBy: admin._id,
  });

  const brandPasswordHash = await hashPassword(E2E_ACCOUNTS.brand.password);
  const brand = await UserModel.create({
    name: E2E_ACCOUNTS.brand.name,
    mobile: E2E_ACCOUNTS.brand.mobile,
    passwordHash: brandPasswordHash,
    role: 'brand',
    roles: ['brand'],
    status: 'active',

    brandCode: E2E_ACCOUNTS.brand.brandCode,

    createdBy: admin._id,
  });

  const shopperPasswordHash = await hashPassword(E2E_ACCOUNTS.shopper.password);
  const shopper = await UserModel.create({
    name: E2E_ACCOUNTS.shopper.name,
    mobile: E2E_ACCOUNTS.shopper.mobile,
    passwordHash: shopperPasswordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',

    // Buyer portal is blocked until the shopper is verified by their mediator.
    // E2E flows assume the seeded shoppers can navigate Explore/Orders immediately.
    isVerifiedByMediator: true,

    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,

    createdBy: admin._id,
  });

  const shopper2PasswordHash = await hashPassword(E2E_ACCOUNTS.shopper2.password);
  const shopper2 = await UserModel.create({
    name: E2E_ACCOUNTS.shopper2.name,
    mobile: E2E_ACCOUNTS.shopper2.mobile,
    passwordHash: shopper2PasswordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',

    isVerifiedByMediator: true,

    parentCode: E2E_ACCOUNTS.mediator.mediatorCode,

    createdBy: admin._id,
  });

  // Ensure role documents (Agency/Brand/MediatorProfile/ShopperProfile) exist.
  await ensureRoleDocumentsForUser({ user: agency });
  await ensureRoleDocumentsForUser({ user: mediator });
  await ensureRoleDocumentsForUser({ user: brand });
  await ensureRoleDocumentsForUser({ user: shopper });
  await ensureRoleDocumentsForUser({ user: shopper2 });

  // Pre-fund brand wallet so ops settlement flows can debit it.
  await WalletModel.findOneAndUpdate(
    { ownerUserId: brand._id, deletedAt: null },
    {
      $setOnInsert: {
        ownerUserId: brand._id,
        currency: 'INR',
      },
      $set: {
        availablePaise: 50_000_00, // ₹50,000
        pendingPaise: 0,
        lockedPaise: 0,
        version: 0,
      },
    },
    { upsert: true, new: true }
  );

  // Minimal campaign + deal so shoppers can list products and create orders.
  const campaign = await CampaignModel.create({
    title: 'E2E Campaign',
    brandUserId: brand._id,
    brandName: E2E_ACCOUNTS.brand.name,
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

    allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
    assignments: {
      [E2E_ACCOUNTS.mediator.mediatorCode]: { limit: 100 },
    },

    createdBy: admin._id,
  });

  await DealModel.create({
    campaignId: campaign._id,
    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    title: 'E2E Deal',
    description: 'Exclusive',
    image: 'https://placehold.co/600x400',
    productUrl: 'https://example.com/product',
    platform: 'Amazon',
    brandName: E2E_ACCOUNTS.brand.name,
    dealType: 'Discount',
    originalPricePaise: 1200_00,
    pricePaise: 999_00,
    commissionPaise: 50_00,
    payoutPaise: 100_00,
    rating: 5,
    category: 'General',
    active: true,
    createdBy: admin._id,
  });

  return { admin, agency, mediator, brand, shopper, shopper2 };
}
