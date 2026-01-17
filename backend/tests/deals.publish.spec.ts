import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';

async function login(app: any, mobile: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ mobile, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.tokens.accessToken as string,
    userId: res.body.user.id as string,
  };
}

describe('ops deals: publish', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('allows mediator to publish when campaign has a slot assignment (even if allowedAgencyCodes is missing)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);
    const mediator = await login(app, E2E_ACCOUNTS.mediator.mobile, E2E_ACCOUNTS.mediator.password);

    const mediatorCode = E2E_ACCOUNTS.mediator.mediatorCode;

    const campaign = await CampaignModel.create({
      title: 'Publish Campaign (missing allowedAgencyCodes)',
      brandUserId: agency.userId as any,
      brandName: 'Agency Inventory',
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 1000_00,
      pricePaise: 900_00,
      payoutPaise: 100_00,
      returnWindowDays: 14,
      dealType: 'Discount',
      totalSlots: 10,
      usedSlots: 0,
      status: 'active',
      allowedAgencyCodes: [],
      assignments: new Map([[mediatorCode, { limit: 3 }]]),
      createdBy: agency.userId as any,
    });

    const res = await request(app)
      .post('/api/ops/deals/publish')
      .set('Authorization', `Bearer ${mediator.token}`)
      .send({
        id: String(campaign._id),
        commission: 50,
        mediatorCode,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    const deal = await DealModel.findOne({ campaignId: (campaign as any)._id, mediatorCode, deletedAt: null }).lean();
    expect(deal).toBeTruthy();
    expect((deal as any)?.active).toBe(true);
  });

  it('allows publishing with commission omitted (defaults to 0)', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);
    const mediator = await login(app, E2E_ACCOUNTS.mediator.mobile, E2E_ACCOUNTS.mediator.password);

    const mediatorCode = E2E_ACCOUNTS.mediator.mediatorCode;

    const campaign = await CampaignModel.create({
      title: 'Publish Campaign (no commission field)',
      brandUserId: agency.userId as any,
      brandName: 'Agency Inventory',
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 1000_00,
      pricePaise: 900_00,
      payoutPaise: 0,
      returnWindowDays: 14,
      dealType: 'Discount',
      totalSlots: 10,
      usedSlots: 0,
      status: 'active',
      allowedAgencyCodes: [],
      assignments: new Map([[mediatorCode, { limit: 3 }]]),
      createdBy: agency.userId as any,
    });

    const res = await request(app)
      .post('/api/ops/deals/publish')
      .set('Authorization', `Bearer ${mediator.token}`)
      .send({
        id: String(campaign._id),
        mediatorCode,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    const deal = await DealModel.findOne({ campaignId: (campaign as any)._id, mediatorCode, deletedAt: null }).lean();
    expect(deal).toBeTruthy();
    expect((deal as any)?.commissionPaise).toBe(0);
    expect((deal as any)?.active).toBe(true);
  });

  it('allows publishing even when commission exceeds payout', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);
    const mediator = await login(app, E2E_ACCOUNTS.mediator.mobile, E2E_ACCOUNTS.mediator.password);

    const mediatorCode = E2E_ACCOUNTS.mediator.mediatorCode;

    const campaign = await CampaignModel.create({
      title: 'Publish Campaign (commission > payout allowed)',
      brandUserId: agency.userId as any,
      brandName: 'Agency Inventory',
      platform: 'Amazon',
      image: 'https://placehold.co/600x400',
      productUrl: 'https://example.com/product',
      originalPricePaise: 1000_00,
      pricePaise: 900_00,
      payoutPaise: 0,
      returnWindowDays: 14,
      dealType: 'Discount',
      totalSlots: 10,
      usedSlots: 0,
      status: 'active',
      allowedAgencyCodes: [],
      assignments: new Map([[mediatorCode, { limit: 3, payout: 0 }]]),
      createdBy: agency.userId as any,
    });

    const res = await request(app)
      .post('/api/ops/deals/publish')
      .set('Authorization', `Bearer ${mediator.token}`)
      .send({
        id: String(campaign._id),
        commission: 999,
        mediatorCode,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    const deal = await DealModel.findOne({ campaignId: (campaign as any)._id, mediatorCode, deletedAt: null }).lean();
    expect(deal).toBeTruthy();
    expect((deal as any)?.commissionPaise).toBe(999_00);
    expect((deal as any)?.payoutPaise).toBe(0);
    expect((deal as any)?.active).toBe(true);
  });
});
