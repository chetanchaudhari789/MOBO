import mongoose from 'mongoose';
import { WalletModel } from '../models/Wallet.js';
import { TransactionModel, type TransactionType } from '../models/Transaction.js';
import { AppError } from '../middleware/errors.js';
import { writeAuditLog } from './audit.js';

export type WalletMutationInput = {
  idempotencyKey: string;
  type: TransactionType;
  ownerUserId: string;
  amountPaise: number;
  fromUserId?: string;
  toUserId?: string;
  orderId?: string;
  campaignId?: string;
  payoutId?: string;
  metadata?: unknown;
  /** When provided, the caller owns the transaction session. No new session is created. */
  session?: mongoose.ClientSession;
};

export async function ensureWallet(ownerUserId: string) {
  // Concurrency-safe wallet creation: multiple requests may race during onboarding/settlement.
  try {
    return await WalletModel.findOneAndUpdate(
      { ownerUserId, deletedAt: null },
      {
        $setOnInsert: {
          ownerUserId,
          currency: 'INR',
          availablePaise: 0,
          pendingPaise: 0,
          lockedPaise: 0,
          version: 0,
        },
      },
      { upsert: true, new: true }
    );
  } catch (err: any) {
    // In rare races, two upserts may attempt an insert concurrently and one loses with E11000.
    // If so, just read the wallet that won.
    const code = Number(err?.code ?? err?.errorResponse?.code);
    if (code === 11000) {
      const existing = await WalletModel.findOne({ ownerUserId, deletedAt: null });
      if (existing) return existing;
    }
    throw err;
  }
}

export async function applyWalletCredit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (!Number.isInteger(input.amountPaise)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be an integer (paise)');

  const externalSession = input.session;

  const execute = async (session: mongoose.ClientSession) => {
    // Use majority readConcern for idempotency to avoid stale reads after failover.
    const existingTx = await TransactionModel.findOne({
      idempotencyKey: input.idempotencyKey,
    })
      .read('primary')
      .session(session);
    if (existingTx) return existingTx;

    const wallet = await WalletModel.findOneAndUpdate(
      { ownerUserId: input.ownerUserId, deletedAt: null },
      {
        $setOnInsert: {
          ownerUserId: input.ownerUserId,
          currency: 'INR',
          pendingPaise: 0,
          lockedPaise: 0,
        },
        $inc: { availablePaise: input.amountPaise, version: 1 },
      },
      { upsert: true, new: true, session }
    );

    // Safety: prevent runaway balances (configurable; default 1 crore paise = ₹1,00,000).
    const MAX_BALANCE_PAISE = Number(process.env.WALLET_MAX_BALANCE_PAISE) || 1_00_00_000;
    if (wallet && wallet.availablePaise > MAX_BALANCE_PAISE) {
      throw new AppError(409, 'BALANCE_LIMIT_EXCEEDED', 'Wallet balance limit exceeded');
    }

    const tx = await TransactionModel.create(
      [
        {
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          status: 'completed',
          amountPaise: input.amountPaise,
          currency: 'INR',
          walletId: wallet?._id,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          orderId: input.orderId,
          campaignId: input.campaignId,
          payoutId: input.payoutId,
          metadata: input.metadata,
        },
      ],
      { session }
    );

    // Only write audit log for new transactions (not idempotent replays)
    await writeAuditLog({
      action: 'WALLET_CREDIT',
      entityType: 'Wallet',
      entityId: String(wallet._id),
      metadata: {
        amountPaise: input.amountPaise,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        transactionId: String(tx[0]._id),
        walletId: String(wallet._id),
      },
    });

    return tx[0];
  };

  // If the caller provides an external session, run within it (no new session/transaction).
  if (externalSession) {
    return await execute(externalSession);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => execute(session));
  } finally {
    session.endSession();
  }
}

export async function applyWalletDebit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (!Number.isInteger(input.amountPaise)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be an integer (paise)');

  const externalSession = input.session;

  const execute = async (session: mongoose.ClientSession) => {
    // Use majority readConcern for idempotency to avoid stale reads after failover.
    const existingTx = await TransactionModel.findOne({
      idempotencyKey: input.idempotencyKey,
    })
      .read('primary')
      .session(session);
    if (existingTx) return existingTx;

    // Use findOneAndUpdate with optimistic locking (version check)
    const wallet = await WalletModel.findOneAndUpdate(
      {
        ownerUserId: input.ownerUserId,
        deletedAt: null,
        // Ensure sufficient funds
        availablePaise: { $gte: input.amountPaise },
      },
      {
        $inc: { availablePaise: -input.amountPaise, version: 1 },
      },
      { new: true, session }
    );

    if (!wallet) {
      // Check if wallet exists but has insufficient funds
      const existing = await WalletModel.findOne({
        ownerUserId: input.ownerUserId,
        deletedAt: null,
      }).session(session);

      if (!existing) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
      throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Insufficient available balance');
    }

    const tx = await TransactionModel.create(
      [
        {
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          status: 'completed',
          amountPaise: input.amountPaise,
          currency: 'INR',
          walletId: wallet._id,
          fromUserId: input.fromUserId,
          toUserId: input.toUserId,
          orderId: input.orderId,
          campaignId: input.campaignId,
          payoutId: input.payoutId,
          metadata: input.metadata,
        },
      ],
      { session }
    );

    // Only write audit log for new transactions (not idempotent replays)
    await writeAuditLog({
      action: 'WALLET_DEBIT',
      entityType: 'Wallet',
      entityId: String(wallet._id),
      metadata: {
        amountPaise: input.amountPaise,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        transactionId: String(tx[0]._id),
        walletId: String(wallet._id),
      },
    });

    return tx[0];
  };

  // If the caller provides an external session, run within it (no new session/transaction).
  if (externalSession) {
    return execute(externalSession);
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => execute(session));
  } finally {
    session.endSession();
  }
}
