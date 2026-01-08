import { loadDotenv } from '../config/dotenvLoader.js';

loadDotenv();

import { loadEnv } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../database/mongo.js';

import { UserModel } from '../models/User.js';
import { WalletModel } from '../models/Wallet.js';
import { AgencyModel } from '../models/Agency.js';
import { BrandModel } from '../models/Brand.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import { TicketModel } from '../models/Ticket.js';
import { PayoutModel } from '../models/Payout.js';
import { TransactionModel } from '../models/Transaction.js';
import { InviteModel } from '../models/Invite.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { SuspensionModel } from '../models/Suspension.js';

function redactMongoUri(uri: string): string {
  // Avoid leaking secrets; keep protocol + host(s) only.
  // Works for mongodb+srv and mongodb URIs.
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/i);
  if (!match) return '<redacted>';

  const proto = match[1];
  const rest = match[2];

  // Strip credentials if present: user:pass@
  const noCreds = rest.replace(/^[^@]+@/, '');

  // Keep hosts up to first slash
  const hosts = noCreds.split('/')[0] ?? '';
  return `${proto}${hosts}/...`;
}

function isLocalishMongoUri(uri: string): boolean {
  const u = uri.toLowerCase();
  if (u.includes('replace_me')) return true;
  if (u.includes('localhost')) return true;
  if (u.includes('127.0.0.1')) return true;
  if (u.includes('0.0.0.0')) return true;
  return false;
}

function requireWipeConfirmation(env: ReturnType<typeof loadEnv>) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to wipe DB in production (NODE_ENV=production).');
  }

  const must = (name: string, expected: string) => {
    const v = (process.env as any)[name];
    if (String(v ?? '') !== expected) {
      throw new Error(`Refusing to wipe DB. Set ${name}=${expected} to confirm.`);
    }
  };

  // Two-step confirmation to prevent accidental wipes.
  must('WIPE_DB', 'true');
  must('WIPE_DB_CONFIRM', 'WIPE');

  const uri = String(process.env.MONGODB_URI ?? '');
  if (!uri) throw new Error('Missing MONGODB_URI.');

  const allowRemote = String(process.env.WIPE_DB_ALLOW_REMOTE ?? '') === 'true';
  if (!allowRemote && !isLocalishMongoUri(uri)) {
    throw new Error(
      `Refusing to wipe a non-local MongoDB URI (${redactMongoUri(uri)}). Set WIPE_DB_ALLOW_REMOTE=true if you are 100% sure.`
    );
  }
}

async function wipeAll() {
  await Promise.all([
    UserModel.deleteMany({}),
    WalletModel.deleteMany({}),
    TransactionModel.deleteMany({}),
    AgencyModel.deleteMany({}),
    BrandModel.deleteMany({}),
    MediatorProfileModel.deleteMany({}),
    ShopperProfileModel.deleteMany({}),
    CampaignModel.deleteMany({}),
    DealModel.deleteMany({}),
    OrderModel.deleteMany({}),
    TicketModel.deleteMany({}),
    PayoutModel.deleteMany({}),
    InviteModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    SuspensionModel.deleteMany({}),
  ]);
}

async function main() {
  const env = loadEnv();
  requireWipeConfirmation(env);

  await connectMongo(env);

  // eslint-disable-next-line no-console
  console.log(`Wiping DB at ${redactMongoUri(String(process.env.MONGODB_URI ?? ''))}`);

  await wipeAll();

  // eslint-disable-next-line no-console
  console.log('✅ DB wipe complete');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo();
  });
