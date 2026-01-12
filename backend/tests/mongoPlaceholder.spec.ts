import { afterEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('connectMongo placeholder handling', () => {
  afterEach(async () => {
    await disconnectMongo();
  });

  it('uses in-memory Mongo when MONGODB_URI contains REPLACE_ME in non-production', async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb+srv://REPLACE_ME',
    });

    await connectMongo(env);

    expect(mongoose.connection.readyState).toBeGreaterThanOrEqual(1);
  });
});
