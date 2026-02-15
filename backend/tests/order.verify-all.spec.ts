import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { OrderModel } from '../models/Order.js';

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

async function loginMediator(app: any, mobile: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ mobile, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.tokens.accessToken as string,
    userId: res.body.user.id as string,
    mediatorCode: res.body.user.mediatorCode as string,
  };
}

const LARGE_DATA_URL = `data:image/png;base64,${'A'.repeat(14000)}`;

describe('verify-all endpoint tests', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('should verify all steps (purchase + review + returnWindow) in one call and transition to APPROVED', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);
    expect(Array.isArray(productsRes.body)).toBe(true);
    expect(productsRes.body.length).toBeGreaterThan(0);

    const deal = productsRes.body[0];

    // Create Review deal (requires purchase + review + returnWindow)
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'E2E Deal'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'E2E Brand'),
          },
        ],
        externalOrderId: `EXT_VERIFY_ALL_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);
    expect(orderId).toBeTruthy();

    // Submit review proof
    const submitReviewRes = await request(app)
      .post('/api/orders/claim')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({ orderId, type: 'review', data: 'https://example.com/review/123' });
    expect(submitReviewRes.status).toBe(200);

    // Submit returnWindow proof
    const submitReturnWindowRes = await request(app)
      .post('/api/orders/claim')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({ orderId, type: 'returnWindow', data: LARGE_DATA_URL });
    expect(submitReturnWindowRes.status).toBe(200);

    // Verify all steps at once
    const verifyAllRes = await request(app)
      .post('/api/ops/orders/verify-all')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId });

    expect(verifyAllRes.status).toBe(200);
    expect(verifyAllRes.body).toHaveProperty('ok', true);
    expect(verifyAllRes.body).toHaveProperty('approved', true);

    // Check final order state
    const finalOrder = await OrderModel.findById(orderId).lean();
    expect(finalOrder).toBeTruthy();
    expect(String((finalOrder as any).workflowStatus)).toBe('APPROVED');
    expect(String((finalOrder as any).affiliateStatus)).toBe('Pending_Cooling');
    expect(!!(finalOrder as any).verification?.order?.verifiedAt).toBe(true);
    expect(!!(finalOrder as any).verification?.review?.verifiedAt).toBe(true);
    expect(!!(finalOrder as any).verification?.returnWindow?.verifiedAt).toBe(true);
  });

  it('should fail when required proofs are missing', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);

    const deal = productsRes.body[0];

    // Create Review deal
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'E2E Deal'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'E2E Brand'),
          },
        ],
        externalOrderId: `EXT_MISSING_PROOF_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Try to verify all without submitting review and returnWindow proofs
    const verifyAllRes = await request(app)
      .post('/api/ops/orders/verify-all')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId });

    expect(verifyAllRes.status).toBe(409);
    expect(verifyAllRes.body).toHaveProperty('code', 'MISSING_PROOFS');
  });

  it('should enforce RBAC - mediator can only verify orders in their network', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const mediator = await loginMediator(app, E2E_ACCOUNTS.mediator.mobile, E2E_ACCOUNTS.mediator.password);

    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);

    const deal = productsRes.body[0];

    // Create order with different managerName
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'E2E Deal'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Cashback',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'E2E Brand'),
          },
        ],
        externalOrderId: `EXT_RBAC_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Modify order to have different managerName
    await OrderModel.findByIdAndUpdate(orderId, { managerName: 'DIFFERENT_CODE' });

    // Mediator tries to verify order outside their network
    const verifyAllRes = await request(app)
      .post('/api/ops/orders/verify-all')
      .set('Authorization', `Bearer ${mediator.token}`)
      .send({ orderId });

    expect(verifyAllRes.status).toBe(403);
    expect(verifyAllRes.body).toHaveProperty('code', 'FORBIDDEN');
  });

  it('should work for Rating deals (purchase + rating + returnWindow)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);

    const deal = productsRes.body[0];

    // Create Rating deal
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'E2E Deal'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Rating',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'E2E Brand'),
          },
        ],
        externalOrderId: `EXT_RATING_ALL_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Submit rating proof
    const submitRatingRes = await request(app)
      .post('/api/orders/claim')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({ orderId, type: 'rating', data: LARGE_DATA_URL });
    expect(submitRatingRes.status).toBe(200);

    // Submit returnWindow proof
    const submitReturnWindowRes = await request(app)
      .post('/api/orders/claim')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({ orderId, type: 'returnWindow', data: LARGE_DATA_URL });
    expect(submitReturnWindowRes.status).toBe(200);

    // Verify all steps at once
    const verifyAllRes = await request(app)
      .post('/api/ops/orders/verify-all')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId });

    expect(verifyAllRes.status).toBe(200);
    expect(verifyAllRes.body).toHaveProperty('ok', true);
    expect(verifyAllRes.body).toHaveProperty('approved', true);

    // Check final order state
    const finalOrder = await OrderModel.findById(orderId).lean();
    expect(finalOrder).toBeTruthy();
    expect(String((finalOrder as any).workflowStatus)).toBe('APPROVED');
    expect(!!(finalOrder as any).verification?.order?.verifiedAt).toBe(true);
    expect(!!(finalOrder as any).verification?.rating?.verifiedAt).toBe(true);
    expect(!!(finalOrder as any).verification?.returnWindow?.verifiedAt).toBe(true);
  });

  it('should work for Cashback deals (only purchase proof required)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);

    const deal = productsRes.body[0];

    // Create Cashback deal
    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'E2E Deal'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Cashback',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'E2E Brand'),
          },
        ],
        externalOrderId: `EXT_CASHBACK_ALL_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Verify all steps (only purchase for Cashback)
    const verifyAllRes = await request(app)
      .post('/api/ops/orders/verify-all')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ orderId });

    expect(verifyAllRes.status).toBe(200);
    expect(verifyAllRes.body).toHaveProperty('ok', true);
    expect(verifyAllRes.body).toHaveProperty('approved', true);

    // Check final order state
    const finalOrder = await OrderModel.findById(orderId).lean();
    expect(finalOrder).toBeTruthy();
    expect(String((finalOrder as any).workflowStatus)).toBe('APPROVED');
    expect(!!(finalOrder as any).verification?.order?.verifiedAt).toBe(true);
  });
});
