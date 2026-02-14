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

  it('returns 400 for invalid orderId format', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    const res = await request(app)
      .get('/api/orders/invalid-id/audit')
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('INVALID_ID');
  });

  it('returns 403 when buyer tries to access another user\'s order audit', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    
    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);
    const brand = await login(app, E2E_ACCOUNTS.brand.mobile, E2E_ACCOUNTS.brand.password);

    // Create an order owned by the brand user
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(brand.userId),
      items: [{
        productId: new mongoose.Types.ObjectId(),
        title: 'Test Product',
        priceAtPurchasePaise: 100000,
        commissionPaise: 5000,
        dealType: 'Discount',
        quantity: 1,
        platform: 'Amazon',
      }],
      totalPaise: 100000,
      workflowStatus: 'ORDERED',
      status: 'Ordered',
      paymentStatus: 'Pending',
      events: [],
    });

    // Shopper tries to access brand's order
    const res = await request(app)
      .get(`/api/orders/${String(order._id)}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('FORBIDDEN');
  });

  it('returns audit logs and events for order owner (buyer)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    
    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Create an order owned by the shopper
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      items: [{
        productId: new mongoose.Types.ObjectId(),
        title: 'Test Product',
        priceAtPurchasePaise: 100000,
        commissionPaise: 5000,
        dealType: 'Discount',
        quantity: 1,
        platform: 'Amazon',
      }],
      totalPaise: 100000,
      workflowStatus: 'ORDERED',
      status: 'Ordered',
      paymentStatus: 'Pending',
      events: [
        {
          type: 'ORDERED',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(shopper.userId),
          metadata: { source: 'test' },
        },
      ],
    });

    // Create an audit log entry
    await AuditLogModel.create({
      entityType: 'Order',
      entityId: String(order._id),
      action: 'CREATED',
      actorUserId: new mongoose.Types.ObjectId(shopper.userId),
      metadata: { test: 'data' },
    });

    const res = await request(app)
      .get(`/api/orders/${String(order._id)}/audit`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logs');
    expect(res.body).toHaveProperty('events');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('limit', 50);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.logs.length).toBeGreaterThan(0);
    expect(res.body.events.length).toBeGreaterThan(0);

    // Verify events are sanitized (no actorUserId)
    const event = res.body.events[0];
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('at');
    expect(event).toHaveProperty('metadata');
    expect(event).not.toHaveProperty('actorUserId');
  });

  it('returns audit logs and events for privileged users (admin)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    
    const admin = await loginAdmin(app, E2E_ACCOUNTS.admin.username, E2E_ACCOUNTS.admin.password);
    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    // Create an order owned by the shopper
    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      items: [{
        productId: new mongoose.Types.ObjectId(),
        title: 'Test Product',
        priceAtPurchasePaise: 100000,
        commissionPaise: 5000,
        dealType: 'Discount',
        quantity: 1,
        platform: 'Amazon',
      }],
      totalPaise: 100000,
      workflowStatus: 'ORDERED',
      status: 'Ordered',
      paymentStatus: 'Pending',
      events: [
        {
          type: 'ORDERED',
          at: new Date(),
          actorUserId: new mongoose.Types.ObjectId(shopper.userId),
          metadata: { source: 'test' },
        },
      ],
    });

    // Admin can access any order's audit
    const res = await request(app)
      .get(`/api/orders/${String(order._id)}/audit`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('logs');
    expect(res.body).toHaveProperty('events');
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('supports pagination parameters', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    
    const shopper = await login(app, E2E_ACCOUNTS.shopper.mobile, E2E_ACCOUNTS.shopper.password);

    const order = await OrderModel.create({
      userId: new mongoose.Types.ObjectId(shopper.userId),
      items: [{
        productId: new mongoose.Types.ObjectId(),
        title: 'Test Product',
        priceAtPurchasePaise: 100000,
        commissionPaise: 5000,
        dealType: 'Discount',
        quantity: 1,
        platform: 'Amazon',
      }],
      totalPaise: 100000,
      workflowStatus: 'ORDERED',
      status: 'Ordered',
      paymentStatus: 'Pending',
      events: [],
    });

    // Create multiple audit log entries
    for (let i = 0; i < 5; i++) {
      await AuditLogModel.create({
        entityType: 'Order',
        entityId: String(order._id),
        action: `ACTION_${i}`,
        actorUserId: new mongoose.Types.ObjectId(shopper.userId),
        metadata: { index: i },
      });
    }

    const res = await request(app)
      .get(`/api/orders/${String(order._id)}/audit?page=1&limit=2`)
      .set('Authorization', `Bearer ${shopper.token}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.logs.length).toBeLessThanOrEqual(2);
  });
});
