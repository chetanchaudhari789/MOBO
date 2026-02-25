import { connectMongo, disconnectMongo } from '../database/mongo.js';

describe('connectMongo stub (MongoDB removed)', () => {
  it('connectMongo is a no-op stub and does not throw', async () => {
    // connectMongo is now a no-op — MongoDB has been removed.
    await expect(connectMongo({} as any)).resolves.toBeUndefined();
  });

  it('disconnectMongo is a no-op stub and does not throw', async () => {
    await expect(disconnectMongo()).resolves.toBeUndefined();
  });
});
