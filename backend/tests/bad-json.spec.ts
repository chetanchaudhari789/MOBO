import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('malformed JSON handling', () => {
  let app: any;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: '<REPLACE_ME>',
    });

    await connectMongo(env);
    app = createApp(env);
  });

  afterAll(async () => {
    await disconnectMongo();
  });

  it('returns 400 BAD_JSON for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('content-type', 'application/json')
      .send('{"mobile":"9000000000",');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'BAD_JSON',
      },
    });
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(String(res.headers['x-request-id'])).toBeTruthy();
  });
});
