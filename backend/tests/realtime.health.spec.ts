import request from 'supertest';

import { createApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('realtime health', () => {
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

  it('GET /api/realtime/health returns ok', async () => {
    const res = await request(app).get('/api/realtime/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
  });

  it('GET /api/realtime/stream requires auth', async () => {
    const res = await request(app).get('/api/realtime/stream');
    expect(res.status).toBe(401);
  });
});
