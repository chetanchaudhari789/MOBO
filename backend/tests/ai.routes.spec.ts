import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('ai routes', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('exposes status and rejects invalid tokens', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    const app = createApp(env);

    const statusRes = await request(app).get('/api/ai/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toHaveProperty('configured', false);

    const badTokenRes = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', 'Bearer definitely-not-a-jwt')
      .send({ message: 'hi', userName: 'Guest' });

    expect(badTokenRes.status).toBe(401);
    expect(badTokenRes.body?.error?.code).toBeTruthy();
  });

  it('validates payloads before calling the AI service', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    const app = createApp(env);

    const tooLong = 'x'.repeat(5000);
    const res = await request(app).post('/api/ai/chat').send({ message: tooLong, userName: 'Guest' });

    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 503 with a stable error code when Gemini is not configured', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    const app = createApp(env);

    const res = await request(app).post('/api/ai/chat').send({ message: 'hello', userName: 'Guest' });

    expect(res.status).toBe(503);
    expect(res.body?.error?.code).toBe('AI_NOT_CONFIGURED');
  });

  it('validates verify-proof payload', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    const app = createApp(env);

    const bad = await request(app).post('/api/ai/verify-proof').send({ expectedOrderId: 'ORD-1', expectedAmount: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body?.error?.code).toBe('BAD_REQUEST');
  });
});
