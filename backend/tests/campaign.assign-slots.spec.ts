import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { CampaignModel } from '../models/Campaign.js';
import { UserModel } from '../models/User.js';

async function login(app: any, mobile: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ mobile, password });
  expect(res.status).toBe(200);
  return {
    token: res.body.tokens.accessToken as string,
    userId: res.body.user.id as string,
  };
}

describe('ops campaigns: assign slots', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('rejects empty/zero allocations and only locks after a real assignment', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);

    const campaign = await CampaignModel.create({
      title: 'Slots Campaign',
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
      allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
      assignments: {},
      createdBy: agency.userId as any,
    });

    const zeroRes = await request(app)
      .post('/api/ops/campaigns/assign')
      .set('Authorization', `Bearer ${agency.token}`)
      .send({
        id: String(campaign._id),
        assignments: { [E2E_ACCOUNTS.mediator.mediatorCode]: 0 },
      });

    expect(zeroRes.status).toBe(400);
    expect(zeroRes.body?.error?.code || zeroRes.body?.code).toBe('NO_ASSIGNMENTS');

    const okRes = await request(app)
      .post('/api/ops/campaigns/assign')
      .set('Authorization', `Bearer ${agency.token}`)
      .send({
        id: String(campaign._id),
        assignments: { [E2E_ACCOUNTS.mediator.mediatorCode]: 5 },
      });

    expect(okRes.status).toBe(200);

    const updated = await CampaignModel.findById(campaign._id).lean();
    expect(updated).toBeTruthy();
    expect((updated as any).locked).toBe(true);

    const assignmentsObj =
      (updated as any).assignments instanceof Map
        ? Object.fromEntries((updated as any).assignments)
        : (updated as any).assignments;

    expect(assignmentsObj?.[E2E_ACCOUNTS.mediator.mediatorCode]).toBeTruthy();
    expect(assignmentsObj?.[E2E_ACCOUNTS.mediator.mediatorCode]?.limit).toBe(5);
  });

  it('prevents agencies from assigning to non-active mediators', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const agency = await login(app, E2E_ACCOUNTS.agency.mobile, E2E_ACCOUNTS.agency.password);

    await UserModel.create({
      name: 'Pending Mediator',
      mobile: '9111111111',
      passwordHash: 'x',
      role: 'mediator',
      roles: ['mediator'],
      status: 'pending',
      mediatorCode: 'MED_PEND',
      parentCode: E2E_ACCOUNTS.agency.agencyCode,
    });

    const campaign = await CampaignModel.create({
      title: 'Slots Campaign 2',
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
      allowedAgencyCodes: [E2E_ACCOUNTS.agency.agencyCode],
      assignments: {},
      createdBy: agency.userId as any,
    });

    const res = await request(app)
      .post('/api/ops/campaigns/assign')
      .set('Authorization', `Bearer ${agency.token}`)
      .send({
        id: String(campaign._id),
        assignments: { MED_PEND: 1 },
      });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code || res.body?.code).toBe('INVALID_MEDIATOR_CODE');
  });
});
