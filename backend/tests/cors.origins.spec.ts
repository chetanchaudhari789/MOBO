import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('CORS origin enforcement', () => {
  let app: any;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: '<REPLACE_ME>',
      CORS_ORIGINS: 'https://allowed.example',
    });

    await connectMongo(env);
    app = createApp(env);
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  it('rejects requests with a disallowed Origin header', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'origin_not_allowed' });
    expect(typeof res.body.requestId).toBe('string');
  });

  it('allows requests with an allowed Origin header', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://allowed.example');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('normalizes entries with trailing slashes/paths/quotes', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: '<REPLACE_ME>',
      CORS_ORIGINS: '"https://allowed.example/",https://allowed.example/api',
    });

    await disconnectMongo();
    await connectMongo(env);
    const app2 = createApp(env);

    const res = await request(app2)
      .get('/api/health')
      .set('Origin', 'https://allowed.example');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });
});
