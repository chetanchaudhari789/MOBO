import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { UserModel } from '../models/User.js';
import { applyWalletCredit } from '../services/walletService.js';

async function login(app: any, mobile: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ mobile, password });
  expect(res.status).toBe(200);
  return res.body.tokens.accessToken as string;
}

describe('brand payouts + ledger', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('records payout and shows it in /brand/transactions', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const brandToken = await login(app, E2E_ACCOUNTS.brand.mobile, E2E_ACCOUNTS.brand.password);

    const brand = await UserModel.findOne({ mobile: E2E_ACCOUNTS.brand.mobile }).lean();
    const agency = await UserModel.findOne({ mobile: E2E_ACCOUNTS.agency.mobile }).lean();
    expect(brand).toBeTruthy();
    expect(agency).toBeTruthy();

    // Connect brand -> agency (required for non-privileged payout).
    await UserModel.updateOne(
      { _id: (brand as any)._id },
      { $addToSet: { connectedAgencies: E2E_ACCOUNTS.agency.agencyCode } }
    );

    // Fund brand wallet so debit succeeds.
    await applyWalletCredit({
      idempotencyKey: 'test-brand-fund',
      type: 'brand_deposit',
      ownerUserId: String((brand as any)._id),
      amountPaise: 500_00, // ₹500
      metadata: { test: true },
    });

    const payoutRes = await request(app)
      .post('/api/brand/payout')
      .set('Authorization', `Bearer ${brandToken}`)
      .send({
        brandId: String((brand as any)._id),
        agencyId: String((agency as any)._id),
        amount: 123,
        ref: 'UTR123',
      });

    expect(payoutRes.status).toBe(200);
    expect(payoutRes.body).toMatchObject({ ok: true });

    const ledgerRes = await request(app)
      .get(`/api/brand/transactions?brandId=${String((brand as any)._id)}`)
      .set('Authorization', `Bearer ${brandToken}`);

    expect(ledgerRes.status).toBe(200);
    expect(Array.isArray(ledgerRes.body)).toBe(true);

    const found = (ledgerRes.body as any[]).find((t) => t.ref === 'UTR123');
    expect(found).toBeTruthy();
    expect(found.amount).toBe(123);
    expect(found.status).toBe('Success');
    expect(typeof found.date).toBe('string');
  });
});
