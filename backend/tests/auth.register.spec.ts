import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { InviteModel } from '../models/Invite.js';
import { UserModel } from '../models/User.js';

async function setup() {
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb+srv://REPLACE_ME',
  });

  await connectMongo(env);
  const seeded = await seedE2E();
  const app = createApp(env);

  return { env, seeded, app };
}

describe('auth registration + invites', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('registers a shopper via invite and consumes the invite', async () => {
    const { app, seeded } = await setup();

    const inviteCode = 'INV_SHOPPER_1';
    await InviteModel.create({
      code: inviteCode,
      role: 'shopper',
      status: 'active',
      parentUserId: seeded.mediator._id,
      parentCode: E2E_ACCOUNTS.mediator.mediatorCode,
      createdBy: seeded.admin._id,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mobile = '9111111111';
    const res = await request(app).post('/api/auth/register').send({
      name: 'New Shopper',
      mobile,
      email: 'shopper@example.com',
      password: 'ChangeMe_123!',
      mediatorCode: inviteCode,
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('mobile', mobile);
    expect(res.body.user).toHaveProperty('role', 'user');
    expect(res.body.user).toHaveProperty('mediatorCode', E2E_ACCOUNTS.mediator.mediatorCode);
    expect(res.body).toHaveProperty('tokens');
    expect(typeof res.body.tokens?.accessToken).toBe('string');

    const invite = await InviteModel.findOne({ code: inviteCode }).lean();
    expect(invite).toBeTruthy();
    expect(invite?.status).toBe('used');
    expect(invite?.useCount).toBe(1);
    expect((invite as any)?.usedBy).toBeTruthy();
    expect(Array.isArray((invite as any)?.uses)).toBe(true);
    expect(((invite as any)?.uses ?? []).length).toBe(1);
  });

  it('registers a mediator via invite and consumes the invite', async () => {
    const { app, seeded } = await setup();

    const inviteCode = 'INV_MEDIATOR_1';
    await InviteModel.create({
      code: inviteCode,
      role: 'mediator',
      status: 'active',
      parentUserId: seeded.agency._id,
      parentCode: E2E_ACCOUNTS.agency.agencyCode,
      createdBy: seeded.admin._id,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mobile = '9222222222';
    const res = await request(app).post('/api/auth/register-ops').send({
      name: 'New Mediator',
      mobile,
      password: 'ChangeMe_123!',
      role: 'mediator',
      code: inviteCode,
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('mobile', mobile);
    expect(res.body.user).toHaveProperty('role', 'mediator');
    expect(res.body.user).toHaveProperty('parentCode', E2E_ACCOUNTS.agency.agencyCode);
    expect(typeof res.body.user?.mediatorCode).toBe('string');
    expect(res.body).toHaveProperty('tokens');
    expect(typeof res.body.tokens?.accessToken).toBe('string');

    const invite = await InviteModel.findOne({ code: inviteCode }).lean();
    expect(invite?.status).toBe('used');
    expect(invite?.useCount).toBe(1);
  });

  it('registers a brand via invite and consumes the invite', async () => {
    const { app, seeded } = await setup();

    const inviteCode = 'INV_BRAND_1';
    await InviteModel.create({
      code: inviteCode,
      role: 'brand',
      status: 'active',
      createdBy: seeded.admin._id,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mobile = '9333333333';
    const res = await request(app).post('/api/auth/register-brand').send({
      name: 'New Brand',
      mobile,
      password: 'ChangeMe_123!',
      brandCode: inviteCode,
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('mobile', mobile);
    expect(res.body.user).toHaveProperty('role', 'brand');
    expect(typeof res.body.user?.brandCode).toBe('string');

    const created = await UserModel.findOne({ mobile }).lean();
    expect(created).toBeTruthy();
    expect(String((created as any)?.createdBy)).toBe(String(seeded.admin._id));

    const invite = await InviteModel.findOne({ code: inviteCode }).lean();
    expect(invite?.status).toBe('used');
    expect(invite?.useCount).toBe(1);
  });

  it('rejects expired invites and does not create a user', async () => {
    const { app, seeded } = await setup();

    const inviteCode = 'INV_EXPIRED_1';
    await InviteModel.create({
      code: inviteCode,
      role: 'agency',
      status: 'active',
      createdBy: seeded.admin._id,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const mobile = '9444444444';
    const res = await request(app).post('/api/auth/register-ops').send({
      name: 'Expired User',
      mobile,
      password: 'ChangeMe_123!',
      role: 'agency',
      code: inviteCode,
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code', 'INVITE_EXPIRED');

    const user = await UserModel.findOne({ mobile }).lean();
    expect(user).toBeNull();

    const invite = await InviteModel.findOne({ code: inviteCode }).lean();
    expect(invite?.status).toBe('expired');
  });

  it('enforces maxUses (replay-safe): second registration fails and user is not created', async () => {
    const { app, seeded } = await setup();

    const inviteCode = 'INV_ONCE_1';
    await InviteModel.create({
      code: inviteCode,
      role: 'agency',
      status: 'active',
      createdBy: seeded.admin._id,
      maxUses: 1,
      useCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const firstMobile = '9555555555';
    const first = await request(app).post('/api/auth/register-ops').send({
      name: 'Agency One',
      mobile: firstMobile,
      password: 'ChangeMe_123!',
      role: 'agency',
      code: inviteCode,
    });
    expect(first.status).toBe(201);

    const secondMobile = '9666666666';
    const second = await request(app).post('/api/auth/register-ops').send({
      name: 'Agency Two',
      mobile: secondMobile,
      password: 'ChangeMe_123!',
      role: 'agency',
      code: inviteCode,
    });
    expect(second.status).toBe(400);
    expect(second.body).toHaveProperty('error');
    expect(second.body.error).toHaveProperty('code', 'INVALID_INVITE');

    const user2 = await UserModel.findOne({ mobile: secondMobile }).lean();
    expect(user2).toBeNull();
  });
});
