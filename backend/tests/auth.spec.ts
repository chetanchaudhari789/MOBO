import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';

describe('auth', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('logs in and calls /me', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);
    await seedE2E();

    const app = createApp(env);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ mobile: E2E_ACCOUNTS.admin.mobile, password: E2E_ACCOUNTS.admin.password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('user');
    expect(loginRes.body).toHaveProperty('tokens');
    expect(typeof loginRes.body.tokens?.accessToken).toBe('string');

    const accessToken = loginRes.body.tokens.accessToken as string;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body).toHaveProperty('user');
    expect(meRes.body.user).toHaveProperty('id');
    expect(meRes.body.user).toHaveProperty('mobile', E2E_ACCOUNTS.admin.mobile);
  });
});
