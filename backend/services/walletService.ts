import mongoose from 'mongoose';
import { WalletModel } from '../models/Wallet.js';
import { TransactionModel, type TransactionType } from '../models/Transaction.js';
import { AppError } from '../middleware/errors.js';

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
};

export async function ensureWallet(ownerUserId: string) {
  const existing = await WalletModel.findOne({ ownerUserId, deletedAt: null });
  if (existing) return existing;
  return WalletModel.create({ ownerUserId, availablePaise: 0, pendingPaise: 0, lockedPaise: 0 });
}

export async function applyWalletCredit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const existingTx = await TransactionModel.findOne({
        idempotencyKey: input.idempotencyKey,
      }).session(session);
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

      return tx[0];
    });
  } finally {
    session.endSession();
  }
}

export async function applyWalletDebit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const existingTx = await TransactionModel.findOne({
        idempotencyKey: input.idempotencyKey,
      }).session(session);
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

      return tx[0];
    });
  } finally {
    session.endSession();
  }
}
