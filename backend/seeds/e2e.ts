import { UserModel } from '../models/User.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { hashPassword } from '../services/passwords.js';
import { ensureWallet } from '../services/walletService.js';

const DEFAULT_PASSWORD = 'ChangeMe_123!';

export type E2ESeedAccounts = {
  admin: { mobile: string; password: string };
  agency: { mobile: string; password: string; agencyCode: string };
  mediator: { mobile: string; password: string; mediatorCode: string; parentAgencyCode: string };
  brand: { mobile: string; password: string; brandCode: string };
  shopper: { mobile: string; password: string; parentMediatorCode: string };
  shopper2: { mobile: string; password: string; parentMediatorCode: string };
};

export const E2E_ACCOUNTS: E2ESeedAccounts = {
  admin: { mobile: 'admin', password: DEFAULT_PASSWORD },
  agency: { mobile: '9000000001', password: DEFAULT_PASSWORD, agencyCode: 'AGY_TEST' },
  mediator: {
    mobile: '9000000002',
    password: DEFAULT_PASSWORD,
    mediatorCode: 'MED_TEST',
    parentAgencyCode: 'AGY_TEST',
  },
  brand: { mobile: '9000000003', password: DEFAULT_PASSWORD, brandCode: 'BRD_TEST' },
  shopper: { mobile: '9000000004', password: DEFAULT_PASSWORD, parentMediatorCode: 'MED_TEST' },
  shopper2: { mobile: '9000000005', password: DEFAULT_PASSWORD, parentMediatorCode: 'MED_TEST' },
};

async function upsertUserByMobile(mobile: string, update: Record<string, unknown>) {
  return UserModel.findOneAndUpdate(
    { mobile },
    { $set: { ...update }, $unset: { deletedAt: '' } },
    { upsert: true, new: true }
  );
}

export async function seedE2E() {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  const admin = await upsertUserByMobile(E2E_ACCOUNTS.admin.mobile, {
    name: 'Master Admin',
    mobile: E2E_ACCOUNTS.admin.mobile,
    passwordHash,
    role: 'admin',
    roles: ['admin'],
    status: 'active',
  });

  const agency = await upsertUserByMobile(E2E_ACCOUNTS.agency.mobile, {
    name: 'E2E Agency',
    mobile: E2E_ACCOUNTS.agency.mobile,
    passwordHash,
    role: 'agency',
    roles: ['agency'],
    status: 'active',
    mediatorCode: E2E_ACCOUNTS.agency.agencyCode,
    kycStatus: 'verified',
  });

  const mediator = await upsertUserByMobile(E2E_ACCOUNTS.mediator.mobile, {
    name: 'E2E Mediator',
    mobile: E2E_ACCOUNTS.mediator.mobile,
    passwordHash,
    role: 'mediator',
    roles: ['mediator'],
    status: 'active',
    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    parentCode: E2E_ACCOUNTS.mediator.parentAgencyCode,
    kycStatus: 'verified',
  });

  const brand = await upsertUserByMobile(E2E_ACCOUNTS.brand.mobile, {
    name: 'E2E Brand',
    mobile: E2E_ACCOUNTS.brand.mobile,
    passwordHash,
    role: 'brand',
    roles: ['brand'],
    status: 'active',
    brandCode: E2E_ACCOUNTS.brand.brandCode,
  });

  const shopper = await upsertUserByMobile(E2E_ACCOUNTS.shopper.mobile, {
    name: 'E2E Shopper',
    mobile: E2E_ACCOUNTS.shopper.mobile,
    passwordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',
    parentCode: E2E_ACCOUNTS.shopper.parentMediatorCode,
    isVerifiedByMediator: true,
  });

  const shopper2 = await upsertUserByMobile(E2E_ACCOUNTS.shopper2.mobile, {
    name: 'E2E Shopper 2',
    mobile: E2E_ACCOUNTS.shopper2.mobile,
    passwordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',
    parentCode: E2E_ACCOUNTS.shopper2.parentMediatorCode,
    isVerifiedByMediator: true,
  });

  await Promise.all([
    ensureWallet(String(admin._id)),
    ensureWallet(String(agency._id)),
    ensureWallet(String(mediator._id)),
    ensureWallet(String(brand._id)),
    ensureWallet(String(shopper._id)),
    ensureWallet(String(shopper2._id)),
  ]);

  // Minimal campaign so dashboards have something to render.
  const existingCampaign = await CampaignModel.findOne({
    title: 'E2E Campaign',
    deletedAt: null,
  });

  const campaign = existingCampaign ?? (await CampaignModel.create({
      title: 'E2E Campaign',
      brandUserId: String(brand._id),
      brandName: 'E2E Brand',
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 199900,
      pricePaise: 99900,
      payoutPaise: 15000,
      totalSlots: 10,
      usedSlots: 0,
      status: 'active',
      allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
      assignments: {
        [E2E_ACCOUNTS.mediator.mediatorCode]: { limit: 5, payout: 15000 },
      },
      locked: false,
      dealType: 'Discount',
      returnWindowDays: 14,
    }));

  // Ensure there is at least one active Deal for the seeded shopper to browse and claim.
  // Deals are unique per (campaignId, mediatorCode).
  const existingDeal = await DealModel.findOne({
    campaignId: campaign._id,
    mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
    deletedAt: null,
  }).lean();

  if (!existingDeal) {
    const commissionPaise = 5000; // ₹50 cashback
    const pricePaise = Number((campaign as any).pricePaise ?? 0) + commissionPaise;

    await DealModel.create({
      campaignId: campaign._id,
      mediatorCode: E2E_ACCOUNTS.mediator.mediatorCode,
      title: String((campaign as any).title),
      description: 'Exclusive',
      image: String((campaign as any).image),
      productUrl: String((campaign as any).productUrl),
      platform: String((campaign as any).platform),
      brandName: String((campaign as any).brandName),
      dealType: 'Discount',
      originalPricePaise: Number((campaign as any).originalPricePaise ?? 0),
      pricePaise,
      commissionPaise,
      payoutPaise: Number((campaign as any).payoutPaise ?? 0),
      active: true,
      category: 'General',
      createdBy: admin._id,
    });
  }

  return {
    admin,
    agency,
    mediator,
    brand,
    shopper,
    shopper2,
  };
}
