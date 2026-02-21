import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { prisma } from '../database/prisma.js';

async function login(app: any, mobile: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ mobile, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.tokens.accessToken as string,
    userId: res.body.user.id as string,
  };
}

async function loginAdmin(app: any, username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.tokens.accessToken as string,
    userId: res.body.user.id as string,
  };
}

const LARGE_DATA_URL = `data:image/png;base64,${'A'.repeat(14000)}`;
describe('core flows: products -> redirect -> order -> claim -> ops verify/settle -> brand payout/connect', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('supports end-to-end API flow (minimal assertions, contract-focused)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    const seeded = await seedE2E();

    const app = createApp(env);
    const db = prisma();

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);
    const brand = await login(app, E2E_ACCOUNTS.brand.mobile, E2E_ACCOUNTS.brand.password);
    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);

    // Products list (shopper-only)
    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(productsRes.status).toBe(200);
    expect(Array.isArray(productsRes.body)).toBe(true);
    expect(productsRes.body.length).toBeGreaterThan(0);

    const dealId = String(productsRes.body[0].id || productsRes.body[0]._id || '');
    expect(dealId).toBeTruthy();

    const deal = await db.deal.findFirst({ where: { mongoId: dealId, deletedAt: null } });
    expect(deal).toBeTruthy();
    const payoutPaise = Number(deal?.payoutPaise ?? 0);
    expect(payoutPaise).toBeGreaterThan(0);

    const brandWalletBefore = await db.wallet.findFirst({ where: { ownerUserId: seeded.pgBrand.id, deletedAt: null } });
    expect(brandWalletBefore).toBeTruthy();
    const brandAvailableBefore = Number(brandWalletBefore?.availablePaise ?? 0);
    // Redirect tracking creates a pre-order
    const redirectRes = await request(app)
      .post(`/api/deals/${dealId}/redirect`)
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({});

    expect(redirectRes.status).toBe(201);
    expect(redirectRes.body).toHaveProperty('preOrderId');
    expect(redirectRes.body).toHaveProperty('url');

    const preOrderId = String(redirectRes.body.preOrderId);

    // Upgrade pre-order into a full order
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        preOrderId,
        items: [
          {
            productId: dealId,
            title: 'E2E Deal',
            image: 'https://placehold.co/600x400',
            priceAtPurchase: 999,
            commission: 50,
            campaignId: String(productsRes.body[0].campaignId || productsRes.body[0].campaign?.id || productsRes.body[0].campaign || ''),
            dealType: 'Discount',
            quantity: 1,
            platform: 'Amazon',
            brandName: 'E2E Brand',
          },
        ],
        externalOrderId: `EXT_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    expect(createOrderRes.body).toHaveProperty('id');

    const orderId = String(createOrderRes.body.id);

    // Claim submission (should be allowed by owner)
    const claimRes = await request(app)
      .post('/api/orders/claim')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({ orderId, type: 'order', data: LARGE_DATA_URL });

    expect(claimRes.status).toBe(200);
    expect(claimRes.body).toHaveProperty('id', orderId);

    // Ops verify (privileged)
    const verifyRes = await request(app)
      .post('/api/ops/verify')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toHaveProperty('ok', true);

    // Ops settle (with optional settlementRef)
    const settleRes = await request(app)
      .post('/api/ops/orders/settle')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId, settlementRef: 'UTR_TEST_123' });

    expect(settleRes.status).toBe(200);
    expect(settleRes.body).toHaveProperty('ok', true);

    const brandWalletAfter = await db.wallet.findFirst({ where: { ownerUserId: seeded.pgBrand.id, deletedAt: null } });
    expect(brandWalletAfter).toBeTruthy();
    const brandAvailableAfter = Number(brandWalletAfter?.availablePaise ?? 0);

    expect(brandAvailableAfter).toBe(brandAvailableBefore - payoutPaise);
    // Shopper can fetch own orders
    const myOrdersRes = await request(app)
      .get(`/api/orders/user/${shopper.userId}`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(myOrdersRes.status).toBe(200);
    expect(Array.isArray(myOrdersRes.body)).toBe(true);
    expect(myOrdersRes.body.some((o: any) => o.id === orderId)).toBe(true);

    // Agency requests brand connection (agency-only)
    const connectRes = await request(app)
      .post('/api/ops/brands/connect')
      .set('Authorization', `Bearer ${agency.token}`)
      .send({ brandCode: E2E_ACCOUNTS.brand.brandCode });

    expect(connectRes.status).toBe(200);
    expect(connectRes.body).toHaveProperty('ok', true);

    // Brand approves connection (brand-only)
    const approveConnRes = await request(app)
      .post('/api/brand/requests/resolve')
      .set('Authorization', `Bearer ${brand.token}`)
      .send({ agencyCode: E2E_ACCOUNTS.agency.agencyCode, action: 'approve' });

    expect(approveConnRes.status).toBe(200);
    expect(approveConnRes.body).toHaveProperty('ok', true);

    // Brand pays out to agency (requires connection)
    const payoutRes = await request(app)
      .post('/api/brand/payout')
      .set('Authorization', `Bearer ${brand.token}`)
      .send({ agencyId: E2E_ACCOUNTS.agency.agencyCode, amount: 10, ref: `REF_${Date.now()}` });

    // NOTE: payout endpoint expects agencyId (Mongo id), not agencyCode.
    // So the call above should fail; verify contract and then do a correct call.
    expect(payoutRes.status).toBe(400);

    // Fetch agencies list and pay using actual agency id.
    const agenciesRes = await request(app)
      .get('/api/brand/agencies')
      .set('Authorization', `Bearer ${brand.token}`);

    expect(agenciesRes.status).toBe(200);
    expect(Array.isArray(agenciesRes.body)).toBe(true);

    const agencyRow = agenciesRes.body.find((a: any) => a.code === E2E_ACCOUNTS.agency.agencyCode || a.mediatorCode === E2E_ACCOUNTS.agency.agencyCode);
    expect(agencyRow).toBeTruthy();

    const agencyId = String(agencyRow.id);

    const payoutOkRes = await request(app)
      .post('/api/brand/payout')
      .set('Authorization', `Bearer ${brand.token}`)
      .send({ agencyId, amount: 10, ref: `REF_OK_${Date.now()}` });

    expect(payoutOkRes.status).toBe(200);
    expect(payoutOkRes.body).toHaveProperty('ok', true);
  });
});
