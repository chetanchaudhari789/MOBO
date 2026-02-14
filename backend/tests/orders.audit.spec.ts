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

const LARGE_DATA_URL = `data:image/png;base64,${'A'.repeat(14000)}`;

describe('GET /orders/:orderId/audit', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('returns 400 for invalid orderId format', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    const res = await request(app)
      .get('/api/orders/invalid-id-format/audit')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_ID');
  });

  it('allows buyer to access their own order audit', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Get products and create an order
    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    expect(productsRes.status).toBe(200);
    const deal = productsRes.body[0];

    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'Test Product'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'Test Brand'),
          },
        ],
        externalOrderId: `EXT_AUDIT_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Buyer should be able to access their own order audit
    const res = await request(app)
      .get(`/api/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logs');
    expect(res.body).toHaveProperty('events');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('returns 403 when buyer tries to access another user\'s order audit', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const shopper1 = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const shopper2 = await login(app, E2E_ACCOUNTS.shopper2.mobile, E2E_ACCOUNTS.shopper2.password);

    // Create an order with shopper1
    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper1.token}`);
    expect(productsRes.status).toBe(200);
    const deal = productsRes.body[0];

    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper1.token}`)
      .send({
        userId: shopper1.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'Test Product'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'Test Brand'),
          },
        ],
        externalOrderId: `EXT_AUDIT_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Shopper2 should NOT be able to access shopper1's order audit
    const res = await request(app)
      .get(`/api/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${shopper2.token}`);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
  });

  it('sanitizes events (strips actorUserId) in response', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Create an order
    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    const deal = productsRes.body[0];

    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'Test Product'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'Test Brand'),
          },
        ],
        externalOrderId: `EXT_AUDIT_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Fetch the audit
    const res = await request(app)
      .get(`/api/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);

    // Verify that events don't contain actorUserId (sensitive field)
    for (const event of res.body.events) {
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('at');
      expect(event).toHaveProperty('metadata');
      expect(event).not.toHaveProperty('actorUserId');
    }
  });

  it('allows privileged roles (admin) to access any order audit', async () => {
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

    // Create an order with shopper
    const productsRes = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${shopper.token}`);
    const deal = productsRes.body[0];

    const createOrderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${shopper.token}`)
      .send({
        userId: shopper.userId,
        items: [
          {
            productId: String(deal.id),
            title: String(deal.title || 'Test Product'),
            image: String(deal.image || 'https://placehold.co/600x400'),
            priceAtPurchase: Number(deal.price || 999),
            commission: Number(deal.commission || 50),
            campaignId: String(deal.campaignId || deal.campaign?.id || deal.campaign || ''),
            dealType: 'Review',
            quantity: 1,
            platform: String(deal.platform || 'Amazon'),
            brandName: String(deal.brandName || 'Test Brand'),
          },
        ],
        externalOrderId: `EXT_AUDIT_${Date.now()}`,
        screenshots: { order: LARGE_DATA_URL },
      });

    expect(createOrderRes.status).toBe(201);
    const orderId = String(createOrderRes.body.id);

    // Admin should be able to access the order audit
    const res = await request(app)
      .get(`/api/orders/${orderId}/audit`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logs');
    expect(res.body).toHaveProperty('events');
  });

  it('returns 404 for non-existent order', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    // Use a valid ObjectId format but non-existent order
    const fakeOrderId = '507f1f77bcf86cd799439011';

    const res = await request(app)
      .get(`/api/orders/${fakeOrderId}/audit`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe('NOT_FOUND');
  });
});
