import request from 'supertest';
import mongoose from 'mongoose';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { OrderModel } from '../models/Order.js';
import { AuditLogModel } from '../models/AuditLog.js';

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

describe('GET /orders/:orderId/audit', () => {
  afterEach(async () => {
    await disconnectMongo();
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

    // Create an order owned by this shopper
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      campaignId: new mongoose.Types.ObjectId(),
      items: [{ title: 'Test Product', quantity: 1, priceAtPurchase: 100 }],
      total: 100,
      status: 'Ordered',
      events: [
        {
          type: 'ORDERED',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(shopper.userId),
          metadata: { campaignId: 'test123' },
        },
      ],
    });

    // Create an audit log for the order
    await AuditLogModel.create({
      entityType: 'Order',
      entityId: String(order._id),
      action: 'CREATE',
      actorUserId: shopper.userId,
      createdAt: new Date(),
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}/audit`)
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

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Create an order owned by a different user
    const differentUserId = new mongoose.Types.ObjectId();
    const order = await OrderModel.create({
      userId: differentUserId,
      campaignId: new mongoose.Types.ObjectId(),
      items: [{ title: 'Test Product', quantity: 1, priceAtPurchase: 100 }],
      total: 100,
      status: 'Ordered',
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
  });

  it('sanitizes events for buyers by removing actorUserId', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Create an order with events containing actorUserId
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      campaignId: new mongoose.Types.ObjectId(),
      items: [{ title: 'Test Product', quantity: 1, priceAtPurchase: 100 }],
      total: 100,
      status: 'Ordered',
      events: [
        {
          type: 'ORDERED',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(),
          metadata: { campaignId: 'test123' },
        },
        {
          type: 'PAYMENT_PENDING',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(),
          metadata: {},
        },
      ],
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    
    // Verify actorUserId is not present in sanitized events
    res.body.events.forEach((event: any) => {
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('at');
      expect(event).toHaveProperty('metadata');
      expect(event).not.toHaveProperty('actorUserId');
    });
  });

  it('allows privileged roles (admin) to access any order audit with full events', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);

    // Create an order owned by someone else
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(),
      campaignId: new mongoose.Types.ObjectId(),
      items: [{ title: 'Test Product', quantity: 1, priceAtPurchase: 100 }],
      total: 100,
      status: 'Ordered',
      events: [
        {
          type: 'ORDERED',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(),
          metadata: { campaignId: 'test123' },
        },
      ],
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}/audit`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    
    // Verify admin gets full events including actorUserId
    expect(res.body.events[0]).toHaveProperty('type');
    expect(res.body.events[0]).toHaveProperty('at');
    expect(res.body.events[0]).toHaveProperty('actorUserId');
    expect(res.body.events[0]).toHaveProperty('metadata');
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

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    const res = await request(app)
      .get('/api/orders/invalid-id-format/audit')
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_ID');
  });

  it('respects pagination parameters', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      SEED_E2E: 'true',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);

    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      campaignId: new mongoose.Types.ObjectId(),
      items: [{ title: 'Test Product', quantity: 1, priceAtPurchase: 100 }],
      total: 100,
      status: 'Ordered',
    });

    const res = await request(app)
      .get(`/api/orders/${order._id}/audit?page=2&limit=10`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);
  });
});
