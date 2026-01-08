import 'dotenv/config';

import { faker } from '@faker-js/faker';
import seedrandom from 'seedrandom';

import { loadEnv } from '../config/env.js';
import { connectMongo } from '../database/mongo.js';

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
import { PayoutModel } from '../models/Payout.js';

import { hashPassword } from '../services/passwords.js';
import { applyWalletCredit } from '../services/walletService.js';
import { ensureWallet } from '../services/walletService.js';
import { disconnectMongo } from '../database/mongo.js';

type SeedOptions = {
  seed: string;
  usersPerRole: number;
  campaigns: number;
  dealsPerMediator: number;
  orders: number;
  tickets: number;
  payouts: number;
};

function makeIndianMobile(): string {
  // deterministic via global seeded RNG
  const n = faker.number.int({ min: 0, max: 9_999_999_999 });
  return `91${String(n).padStart(10, '0')}`;
}

function parseArgs(): SeedOptions {
  const seed = process.env.SEED ?? 'mobo-seed';
  const usersPerRole = Number(process.env.SEED_USERS_PER_ROLE ?? '500');
  const campaigns = Number(process.env.SEED_CAMPAIGNS ?? '200');
  const dealsPerMediator = Number(process.env.SEED_DEALS_PER_MEDIATOR ?? '10');
  const orders = Number(process.env.SEED_ORDERS ?? String(usersPerRole));
  const tickets = Number(process.env.SEED_TICKETS ?? String(Math.max(25, Math.floor(orders / 10))));
  const payouts = Number(process.env.SEED_PAYOUTS ?? String(Math.max(10, Math.floor(usersPerRole / 10))));
  return { seed, usersPerRole, campaigns, dealsPerMediator, orders, tickets, payouts };
}

async function wipe() {
  await Promise.all([
    UserModel.deleteMany({}),
    WalletModel.deleteMany({}),
    AgencyModel.deleteMany({}),
    BrandModel.deleteMany({}),
    MediatorProfileModel.deleteMany({}),
    ShopperProfileModel.deleteMany({}),
    CampaignModel.deleteMany({}),
    DealModel.deleteMany({}),
    OrderModel.deleteMany({}),
    TicketModel.deleteMany({}),
    PayoutModel.deleteMany({}),
  ]);
}

const DEFAULT_PASSWORD = 'ChangeMe_123!';

export async function runLargeSeed(params?: { wipe?: boolean }) {
  const env = loadEnv();
  const opts = parseArgs();

  await connectMongo(env);

  // Deterministic randomness
  seedrandom(opts.seed, { global: true });
  faker.seed(Math.abs(opts.seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0)));

  const doWipe = params?.wipe ?? process.env.SEED_WIPE === 'true';
  if (!doWipe) {
    throw new Error('Refusing to seed without SEED_WIPE=true (prevents accidental wipes).');
  }

  await wipe();

  const defaultPasswordHash = await hashPassword(DEFAULT_PASSWORD);

  // Stable demo accounts (used by portals + E2E)
  const admin = await UserModel.create({
    name: 'Master Admin',
    mobile: 'admin',
    passwordHash: defaultPasswordHash,
    role: 'admin',
    roles: ['admin'],
    status: 'active',
  });

  const demoAgencyCode = 'AGY_TEST';
  const demoMediatorCode = 'MED_TEST';
  const demoBrandCode = 'BRD_TEST';

  const demoAgency = await UserModel.create({
    name: 'Demo Agency',
    mobile: '9000000001',
    passwordHash: defaultPasswordHash,
    role: 'agency',
    roles: ['agency'],
    status: 'active',
    mediatorCode: demoAgencyCode,
    kycStatus: 'verified',
  });

  await AgencyModel.create({
    name: 'Demo Agency',
    agencyCode: demoAgencyCode,
    ownerUserId: demoAgency._id,
    status: 'active',
  });

  const demoMediator = await UserModel.create({
    name: 'Demo Mediator',
    mobile: '9000000002',
    passwordHash: defaultPasswordHash,
    role: 'mediator',
    roles: ['mediator'],
    status: 'active',
    mediatorCode: demoMediatorCode,
    parentCode: demoAgencyCode,
    kycStatus: 'verified',
  });

  await MediatorProfileModel.create({
    userId: demoMediator._id,
    mediatorCode: demoMediatorCode,
    parentAgencyCode: demoAgencyCode,
    status: 'active',
  });

  const demoBrand = await UserModel.create({
    name: 'Demo Brand',
    mobile: '9000000003',
    passwordHash: defaultPasswordHash,
    role: 'brand',
    roles: ['brand'],
    status: 'active',
    brandCode: demoBrandCode,
  });

  await BrandModel.create({
    name: 'Demo Brand',
    brandCode: demoBrandCode,
    ownerUserId: demoBrand._id,
    status: 'active',
    connectedAgencyCodes: [demoAgencyCode],
  });

  const demoShopper = await UserModel.create({
    name: 'Demo Buyer',
    mobile: '9000000004',
    passwordHash: defaultPasswordHash,
    role: 'shopper',
    roles: ['shopper'],
    status: 'active',
    parentCode: demoMediatorCode,
    isVerifiedByMediator: true,
  });

  await ShopperProfileModel.create({
    userId: demoShopper._id,
    defaultMediatorCode: demoMediatorCode,
  });

  await Promise.all([
    ensureWallet(String(admin._id)),
    ensureWallet(String(demoAgency._id)),
    ensureWallet(String(demoMediator._id)),
    ensureWallet(String(demoBrand._id)),
    ensureWallet(String(demoShopper._id)),
  ]);

  // Create agencies + agency owner users
  const agencies: { agencyCode: string; ownerUserId: string; name: string }[] = [
    { agencyCode: demoAgencyCode, ownerUserId: String(demoAgency._id), name: 'Demo Agency' },
  ];
  for (let i = 0; i < Math.max(2, Math.floor(opts.usersPerRole / 50)); i++) {
    const agencyCode = `AGY_${faker.string.alpha({ length: 6, casing: 'upper' })}_${i}`;
    const agencyName = `${faker.company.name()} Growth`;
    const owner = await UserModel.create({
      name: `${agencyName} Owner`,
      mobile: makeIndianMobile(),
      passwordHash: defaultPasswordHash,
      role: 'agency',
      roles: ['agency'],
      status: 'active',
      mediatorCode: agencyCode,
      kycStatus: faker.helpers.arrayElement(['pending', 'verified']),
    });

    await AgencyModel.create({
      name: agencyName,
      agencyCode,
      ownerUserId: owner._id,
      status: 'active',
    });

    agencies.push({ agencyCode, ownerUserId: String(owner._id), name: agencyName });

    // give agencies starting funds
    await applyWalletCredit({
      idempotencyKey: `seed-agency-fund-${agencyCode}`,
      type: 'brand_deposit',
      ownerUserId: String(owner._id),
      amountPaise: faker.number.int({ min: 50_000_00, max: 500_000_00 }),
      metadata: { seeded: true },
    });
  }

  // Create brands + brand owner users
  const brands: {
    brandCode: string;
    ownerUserId: string;
    name: string;
    connectedAgencyCodes: string[];
  }[] = [
    {
      brandCode: demoBrandCode,
      ownerUserId: String(demoBrand._id),
      name: 'Demo Brand',
      connectedAgencyCodes: [demoAgencyCode],
    },
  ];
  for (let i = 0; i < Math.max(5, Math.floor(opts.usersPerRole / 25)); i++) {
    const brandCode = `BRD_${faker.string.alpha({ length: 6, casing: 'upper' })}_${i}`;
    const brandName = faker.company.name();

    const owner = await UserModel.create({
      name: `${brandName} Brand`,
      mobile: makeIndianMobile(),
      passwordHash: defaultPasswordHash,
      role: 'brand',
      roles: ['brand'],
      status: 'active',
      brandCode,
    });

    const connectedAgencyCodes = faker.helpers.arrayElements(
      agencies.map((a) => a.agencyCode),
      { min: 1, max: Math.min(5, agencies.length) }
    );

    await BrandModel.create({
      name: brandName,
      brandCode,
      ownerUserId: owner._id,
      status: 'active',
      connectedAgencyCodes,
    });

    brands.push({
      brandCode,
      ownerUserId: String(owner._id),
      name: brandName,
      connectedAgencyCodes,
    });

    // give brands budget
    await applyWalletCredit({
      idempotencyKey: `seed-brand-fund-${brandCode}`,
      type: 'brand_deposit',
      ownerUserId: String(owner._id),
      amountPaise: faker.number.int({ min: 1_000_000_00, max: 20_000_000_00 }),
      metadata: { seeded: true },
    });
  }

  // Create mediators
  const mediators: { mediatorCode: string; userId: string; parentAgencyCode: string }[] = [
    { mediatorCode: demoMediatorCode, userId: String(demoMediator._id), parentAgencyCode: demoAgencyCode },
  ];
  for (let i = 0; i < opts.usersPerRole; i++) {
    const parentAgency = faker.helpers.arrayElement(agencies);
    const mediatorCode = `MED_${faker.string.alpha({ length: 7, casing: 'upper' })}_${i}`;

    const user = await UserModel.create({
      name: faker.person.fullName(),
      mobile: makeIndianMobile(),
      passwordHash: defaultPasswordHash,
      role: 'mediator',
      roles: ['mediator'],
      status: faker.helpers.weightedArrayElement([
        { weight: 90, value: 'active' },
        { weight: 7, value: 'pending' },
        { weight: 3, value: 'suspended' },
      ]),
      mediatorCode,
      parentCode: parentAgency.agencyCode,
      kycStatus: faker.helpers.arrayElement(['pending', 'verified', 'rejected']),
    });

    await MediatorProfileModel.create({
      userId: user._id,
      mediatorCode,
      parentAgencyCode: parentAgency.agencyCode,
      status: user.status,
    });

    mediators.push({
      mediatorCode,
      userId: String(user._id),
      parentAgencyCode: parentAgency.agencyCode,
    });

    await applyWalletCredit({
      idempotencyKey: `seed-mediator-fund-${mediatorCode}`,
      type: 'commission_settle',
      ownerUserId: String(user._id),
      amountPaise: faker.number.int({ min: 0, max: 200_000_00 }),
      metadata: { seeded: true },
    });
  }

  // Create shoppers
  const shoppers: { userId: string; name: string; mobile: string; mediatorCode: string }[] = [
    { userId: String(demoShopper._id), name: 'Demo Buyer', mobile: '9000000004', mediatorCode: demoMediatorCode },
  ];
  for (let i = 0; i < opts.usersPerRole; i++) {
    const mediator = faker.helpers.arrayElement(mediators);
    const verified = faker.datatype.boolean(0.85);

    const user = await UserModel.create({
      name: faker.person.fullName(),
      mobile: makeIndianMobile(),
      passwordHash: defaultPasswordHash,
      role: 'shopper',
      roles: ['shopper'],
      status: 'active',
      parentCode: mediator.mediatorCode,
      isVerifiedByMediator: verified,
    });

    await ShopperProfileModel.create({
      userId: user._id,
      defaultMediatorCode: mediator.mediatorCode,
    });

    shoppers.push({
      userId: String(user._id),
      name: String((user as any).name),
      mobile: String((user as any).mobile),
      mediatorCode: mediator.mediatorCode,
    });

    await applyWalletCredit({
      idempotencyKey: `seed-shopper-fund-${user._id}`,
      type: 'cashback_settle',
      ownerUserId: String(user._id),
      amountPaise: faker.number.int({ min: 0, max: 50_000_00 }),
      metadata: { seeded: true },
    });
  }

  // Create campaigns
  const campaigns: any[] = [];
  for (let i = 0; i < opts.campaigns; i++) {
    const brand = faker.helpers.arrayElement(brands);
    const allowedAgencyCodes = faker.helpers.arrayElements(brand.connectedAgencyCodes, {
      min: 1,
      max: Math.min(3, brand.connectedAgencyCodes.length),
    });

    const original = faker.number.int({ min: 999_00, max: 99_999_00 });
    const discounted = Math.max(
      1,
      Math.floor(original * faker.number.float({ min: 0.4, max: 0.9 }))
    );

    const doc = await CampaignModel.create({
      title: faker.commerce.productName(),
      brandUserId: brand.ownerUserId,
      brandName: brand.name,
      platform: faker.helpers.arrayElement(['Amazon', 'Flipkart', 'Myntra']),
      image: faker.image.url(),
      productUrl: faker.internet.url(),
      originalPricePaise: original,
      pricePaise: discounted,
      payoutPaise: faker.number.int({ min: 50_00, max: 5_000_00 }),
      returnWindowDays: faker.number.int({ min: 7, max: 30 }),
      totalSlots: faker.number.int({ min: 100, max: 10_000 }),
      usedSlots: faker.number.int({ min: 0, max: 5000 }),
      status: faker.helpers.weightedArrayElement([
        { weight: 10, value: 'draft' },
        { weight: 70, value: 'active' },
        { weight: 10, value: 'paused' },
        { weight: 10, value: 'completed' },
      ]),
      allowedAgencyCodes,
      assignments: {},
      dealType: faker.helpers.arrayElement(['Discount', 'Review', 'Rating']),
    });
    campaigns.push(doc);
  }

  // Create deals for mediators (only from active campaigns that their agency is allowed to access)
  const activeCampaigns = campaigns.filter((c) => c.status === 'active');
  for (const mediator of mediators) {
    const accessible = activeCampaigns.filter((c) => (c.allowedAgencyCodes ?? []).includes(mediator.parentAgencyCode));
    if (!accessible.length) continue;
    const chosen = faker.helpers.arrayElements(accessible, {
      min: 0,
      max: Math.min(opts.dealsPerMediator, accessible.length),
    });
    for (const c of chosen) {
      // eslint-disable-next-line no-await-in-loop
      await DealModel.updateOne(
        { campaignId: c._id, mediatorCode: mediator.mediatorCode, deletedAt: { $exists: false } },
        {
          $setOnInsert: {
            campaignId: c._id,
            mediatorCode: mediator.mediatorCode,
            title: c.title,
            description: 'Exclusive',
            image: c.image,
            productUrl: c.productUrl,
            platform: c.platform,
            brandName: c.brandName,
            dealType: c.dealType,
            originalPricePaise: c.originalPricePaise,
            pricePaise: c.pricePaise,
            commissionPaise: c.payoutPaise,
            category: faker.helpers.arrayElement(['Beauty', 'Grocery', 'Electronics', 'Fashion', 'General']),
            active: true,
          },
        },
        { upsert: true }
      );
    }
  }

  // Create orders across workflow states
  const dealIndex = await DealModel.find({ active: true, deletedAt: { $exists: false } })
    .limit(50_000)
    .lean();
  const dealsByMediator = new Map<string, any[]>();
  for (const d of dealIndex) {
    const arr = dealsByMediator.get(String((d as any).mediatorCode)) ?? [];
    arr.push(d);
    dealsByMediator.set(String((d as any).mediatorCode), arr);
  }

  const workflowStates = [
    'REDIRECTED',
    'ORDERED',
    'PROOF_SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'COMPLETED',
  ] as const;

  const ordersToCreate = Math.min(opts.orders, shoppers.length);
  const createdOrders: any[] = [];
  for (let i = 0; i < ordersToCreate; i++) {
    const shopper = shoppers[i];
    const mediatorDeals = dealsByMediator.get(shopper.mediatorCode) ?? [];
    if (!mediatorDeals.length) continue;
    const deal = faker.helpers.arrayElement(mediatorDeals);

    const campaign = activeCampaigns.find((c) => String(c._id) === String((deal as any).campaignId));
    if (!campaign) continue;

    type WorkflowStatus = (typeof workflowStates)[number];

    const workflowWeights: Array<{ value: WorkflowStatus; weight: number }> = workflowStates.map((s) => ({
      value: s,
      weight: s === 'COMPLETED' ? 10 : s === 'REJECTED' ? 6 : 14,
    }));

    const workflowStatus: WorkflowStatus = faker.helpers.weightedArrayElement(workflowWeights);

    // eslint-disable-next-line no-await-in-loop
    const order = await OrderModel.create({
      userId: shopper.userId as any,
      brandUserId: (campaign as any).brandUserId,
      items: [
        {
          productId: faker.string.uuid(),
          title: String((deal as any).title),
          image: String((deal as any).image),
          priceAtPurchasePaise: Number((deal as any).pricePaise),
          commissionPaise: Number((deal as any).commissionPaise),
          campaignId: (deal as any).campaignId,
          dealType: String((deal as any).dealType),
          quantity: 1,
          platform: String((deal as any).platform),
          brandName: String((deal as any).brandName),
        },
      ],
      totalPaise: Number((deal as any).pricePaise),
      workflowStatus,
      status: workflowStatus === 'COMPLETED' ? 'Delivered' : 'Ordered',
      paymentStatus: workflowStatus === 'COMPLETED' ? 'Paid' : 'Pending',
      affiliateStatus: workflowStatus === 'REJECTED' ? 'Rejected' : 'Unchecked',
      externalOrderId: `EXT_${faker.string.alphanumeric({ length: 10, casing: 'upper' })}_${i}`,
      managerName: shopper.mediatorCode,
      agencyName: '',
      buyerName: shopper.name,
      buyerMobile: shopper.mobile,
      brandName: String((deal as any).brandName),
      events: [{ type: 'SEEDED', at: new Date(), metadata: { seeded: true, workflowStatus } }],
    });
    createdOrders.push(order);
  }

  // Tickets
  for (let i = 0; i < Math.min(opts.tickets, createdOrders.length); i++) {
    const order = createdOrders[i];
    // eslint-disable-next-line no-await-in-loop
    const buyer = await UserModel.findById((order as any).userId).lean();
    if (!buyer) continue;
    // eslint-disable-next-line no-await-in-loop
    await TicketModel.create({
      userId: (buyer as any)._id,
      userName: String((buyer as any).name),
      role: String((buyer as any).role),
      orderId: String((order as any)._id),
      issueType: faker.helpers.arrayElement(['Payment', 'Order', 'Proof', 'Settlement', 'Account']),
      description: faker.lorem.sentences({ min: 1, max: 3 }),
      status: faker.helpers.arrayElement(['Open', 'Resolved', 'Rejected']),
    });
  }

  // Payout requests for a subset of mediators
  for (let i = 0; i < Math.min(opts.payouts, mediators.length); i++) {
    const mediator = mediators[i];
    const wallet = await ensureWallet(mediator.userId);
    // eslint-disable-next-line no-await-in-loop
    await PayoutModel.create({
      beneficiaryUserId: mediator.userId as any,
      walletId: (wallet as any)._id,
      amountPaise: faker.number.int({ min: 500_00, max: 50_000_00 }),
      status: faker.helpers.arrayElement(['requested', 'processing', 'paid', 'failed']),
      requestedAt: faker.date.recent({ days: 30 }),
    });
  }

  // eslint-disable-next-line no-console
  console.log('✅ Large seed complete');
  // eslint-disable-next-line no-console
  console.log({
    seed: opts.seed,
    usersPerRole: opts.usersPerRole,
    campaigns: opts.campaigns,
    dealsPerMediator: opts.dealsPerMediator,
    ordersCreated: createdOrders.length,
    tickets: Math.min(opts.tickets, createdOrders.length),
    payouts: Math.min(opts.payouts, mediators.length),
    credentials: {
      admin: { mobile: 'admin', password: DEFAULT_PASSWORD },
      agency: { mobile: '9000000001', password: DEFAULT_PASSWORD, agencyCode: demoAgencyCode },
      mediator: {
        mobile: '9000000002',
        password: DEFAULT_PASSWORD,
        mediatorCode: demoMediatorCode,
        parentAgencyCode: demoAgencyCode,
      },
      brand: { mobile: '9000000003', password: DEFAULT_PASSWORD, brandCode: demoBrandCode },
      buyer: { mobile: '9000000004', password: DEFAULT_PASSWORD, parentMediatorCode: demoMediatorCode },
    },
  });
}

async function main() {
  await runLargeSeed();

  await disconnectMongo();
}

function isDirectlyExecuted(): boolean {
  // In ESM, detect "node/tsx path/to/file" execution.
  // When imported (e.g. by backend/index.ts), we must NOT auto-run.
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.replace(/\\/g, '/').endsWith('/backend/seeds/seed.ts') || entry.replace(/\\/g, '/').endsWith('/seeds/seed.ts');
}

if (isDirectlyExecuted()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  });
}
