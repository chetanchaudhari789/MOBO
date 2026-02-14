import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';
import { seedE2E, E2E_ACCOUNTS } from '../seeds/e2e.js';

/** Helper: login and return bearer token */
async function loginShopper(app: any) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ mobile: E2E_ACCOUNTS.shopper.mobile, password: E2E_ACCOUNTS.shopper.password });
  expect(res.status).toBe(200);
  return res.body.tokens.accessToken as string;
}

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
    await seedE2E();
    const app = createApp(env);
    const token = await loginShopper(app);

    const bad = await request(app)
      .post('/api/ai/verify-proof')
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedOrderId: 'ORD-1', expectedAmount: 100 });
    expect(bad.status).toBe(400);
    expect(bad.body?.error?.code).toBe('BAD_REQUEST');
  });

  it('validates extract-order payload and returns 503 when Gemini is not configured', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    const token = await loginShopper(app);

    const bad = await request(app)
      .post('/api/ai/extract-order')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(bad.status).toBe(400);
    expect(bad.body?.error?.code).toBe('BAD_REQUEST');

    // Minimal valid 1x1 white PNG so Sharp/Tesseract can process it without
    // "unsupported image format" errors.
    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
      'AAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    const res = await request(app)
      .post('/api/ai/extract-order')
      .set('Authorization', `Bearer ${token}`)
      .send({ imageBase64: TINY_PNG });

    // extract-order now runs Tesseract fallback even without Gemini,
    // so it returns 200 with low-confidence results instead of 503.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('confidenceScore');
  });

  it('validates verify-rating payload including expectedReviewerName', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
      GEMINI_API_KEY: '',
    });

    await connectMongo(env);
    await seedE2E();
    const app = createApp(env);
    const token = await loginShopper(app);

    const TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
      'AAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    // Valid request with expectedReviewerName
    const validReq = await request(app)
      .post('/api/ai/verify-rating')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageBase64: TINY_PNG,
        expectedBuyerName: 'John Doe',
        expectedProductName: 'Test Product',
        expectedReviewerName: 'JohnD123',
      });
    // Will succeed (200) or fail due to AI not configured (503), but should not be 400
    expect([200, 503]).toContain(validReq.status);

    // Reject expectedReviewerName > 200 chars
    const tooLongName = 'x'.repeat(201);
    const tooLongReq = await request(app)
      .post('/api/ai/verify-rating')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageBase64: TINY_PNG,
        expectedBuyerName: 'John Doe',
        expectedProductName: 'Test Product',
        expectedReviewerName: tooLongName,
      });
    expect(tooLongReq.status).toBe(400);
    expect(tooLongReq.body?.error?.code).toBe('BAD_REQUEST');

    // Accept request without expectedReviewerName (backward compatibility)
    const noReviewerNameReq = await request(app)
      .post('/api/ai/verify-rating')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imageBase64: TINY_PNG,
        expectedBuyerName: 'John Doe',
        expectedProductName: 'Test Product',
      });
    expect([200, 503]).toContain(noReviewerNameReq.status);
  });
});
