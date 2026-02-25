import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';
import { prisma } from '../database/prisma.js';
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
    const _seeded = await seedE2E();

    const app = createApp(env);
    const db = prisma();

    const brandToken = await login(app, E2E_ACCOUNTS.brand.mobile, E2E_ACCOUNTS.brand.password);

    const brand = await db.user.findFirst({ where: { mobile: E2E_ACCOUNTS.brand.mobile, deletedAt: null } });
    const agency = await db.user.findFirst({ where: { mobile: E2E_ACCOUNTS.agency.mobile, deletedAt: null } });
    expect(brand).toBeTruthy();
    expect(agency).toBeTruthy();

    // Connect brand -> agency in PG (required for non-privileged payout).
    await db.user.update({
      where: { id: brand!.id },
      data: { connectedAgencies: { push: E2E_ACCOUNTS.agency.agencyCode } },
    });

    // Fund brand wallet so debit succeeds (ownerUserId must be PG UUID).
    await applyWalletCredit({
      idempotencyKey: 'test-brand-fund',
      type: 'brand_deposit',
      ownerUserId: brand!.id,
      amountPaise: 500_00, // ₹500
      metadata: { test: true },
    });

    const payoutRes = await request(app)
      .post('/api/brand/payout')
      .set('Authorization', `Bearer ${brandToken}`)
      .send({
        brandId: brand!.id,
        agencyId: agency!.id,
        amount: 123,
        ref: 'UTR123',
      });

    expect(payoutRes.status).toBe(200);
    expect(payoutRes.body).toMatchObject({ ok: true });

    const ledgerRes = await request(app)
      .get(`/api/brand/transactions?brandId=${brand!.id}`)
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
