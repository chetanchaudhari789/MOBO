import { Types } from 'mongoose';
import { prisma } from '../database/prisma.js';
import { AppError } from '../middleware/errors.js';
import { writeAuditLog } from './audit.js';

/** Re-export the union so callers don't have to change imports. */
export type TransactionType =
  | 'brand_deposit' | 'platform_fee'
  | 'commission_lock' | 'commission_settle'
  | 'cashback_lock' | 'cashback_settle'
  | 'order_settlement_debit'
  | 'commission_reversal' | 'margin_reversal'
  | 'agency_payout' | 'agency_receipt'
  | 'payout_request' | 'payout_complete' | 'payout_failed'
  | 'refund';

export type WalletMutationInput = {
  idempotencyKey: string;
  type: TransactionType;
  /** PG UUID of the wallet owner */
  ownerUserId: string;
  amountPaise: number;
  fromUserId?: string;
  toUserId?: string;
  orderId?: string;
  campaignId?: string;
  payoutId?: string;
  metadata?: unknown;
  /** When provided, the caller owns the Prisma interactive transaction. */
  tx?: any;
};

/**
 * Concurrency-safe wallet creation via Prisma upsert.
 * @param ownerUserId PG UUID of the user
 */
export async function ensureWallet(ownerUserId: string) {
  const db = prisma();
  try {
    return await db.wallet.upsert({
      where: { ownerUserId },
      update: {
        // Revive a soft-deleted wallet so ensureWallet always returns an active wallet
        deletedAt: null,
        deletedBy: null,
      },
      create: {
        mongoId: new Types.ObjectId().toString(),
        ownerUserId,
        currency: 'INR',
        availablePaise: 0,
        pendingPaise: 0,
        lockedPaise: 0,
        version: 0,
      },
    });
  } catch (err: any) {
    // Handle P2002 (unique constraint violation) same as MongoDB E11000
    if (err?.code === 'P2002') {
      const existing = await db.wallet.findUnique({ where: { ownerUserId } });
      if (existing) return existing;
    }
    throw err;
  }
}

export async function applyWalletCredit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (!Number.isInteger(input.amountPaise)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be an integer (paise)');

  const execute = async (tx: any) => {
    // Idempotency: if a transaction with this key already exists, return it.
    const existingTx = await tx.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingTx) return existingTx;

    // Upsert wallet and atomically increment balance; refuse credits to soft-deleted wallets
    const existing = await tx.wallet.findUnique({ where: { ownerUserId: input.ownerUserId } });
    if (existing?.deletedAt != null) {
      throw new AppError(409, 'WALLET_DELETED', 'Cannot apply credit to a deleted wallet');
    }
    const wallet = await tx.wallet.upsert({
      where: { ownerUserId: input.ownerUserId },
      update: {
        availablePaise: { increment: input.amountPaise },
        version: { increment: 1 },
      },
      create: {
        mongoId: new Types.ObjectId().toString(),
        ownerUserId: input.ownerUserId,
        currency: 'INR',
        availablePaise: input.amountPaise,
        pendingPaise: 0,
        lockedPaise: 0,
        version: 1,
      },
    });

    // Safety: prevent runaway balances (default 1 crore paise = ₹1,00,000).
    const MAX_BALANCE_PAISE = Number(process.env.WALLET_MAX_BALANCE_PAISE) || 1_00_00_000;
    if (wallet.availablePaise > MAX_BALANCE_PAISE) {
      throw new AppError(409, 'BALANCE_LIMIT_EXCEEDED', 'Wallet balance limit exceeded');
    }

    const txn = await tx.transaction.create({
      data: {
        mongoId: new Types.ObjectId().toString(),
        idempotencyKey: input.idempotencyKey,
        type: input.type as any,
        status: 'completed',
        amountPaise: input.amountPaise,
        currency: 'INR',
        walletId: wallet.id,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        orderId: input.orderId,
        campaignId: input.campaignId,
        payoutId: input.payoutId,
        metadata: input.metadata as any,
      },
    });

    return txn;
  };

  // If the caller provides an external tx, run within it (no new transaction).
  if (input.tx) {
    const result = await execute(input.tx);
    writeAuditLog({ action: 'WALLET_CREDIT', entityType: 'Wallet', entityId: input.ownerUserId, metadata: { amountPaise: input.amountPaise, type: input.type, idempotencyKey: input.idempotencyKey } });
    return result;
  }

  const db = prisma();
  const result = await db.$transaction(async (tx) => execute(tx));
  writeAuditLog({ action: 'WALLET_CREDIT', entityType: 'Wallet', entityId: input.ownerUserId, metadata: { amountPaise: input.amountPaise, type: input.type, idempotencyKey: input.idempotencyKey } });
  return result;
}

export async function applyWalletDebit(input: WalletMutationInput) {
  if (input.amountPaise <= 0) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be positive');
  if (!Number.isInteger(input.amountPaise)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be an integer (paise)');

  const execute = async (tx: any) => {
    // Idempotency: if a transaction with this key already exists, return it.
    const existingTx = await tx.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingTx) return existingTx;

    // Atomic debit with balance-floor check via updateMany
    const updated = await tx.wallet.updateMany({
      where: {
        ownerUserId: input.ownerUserId,
        deletedAt: null,
        availablePaise: { gte: input.amountPaise },
      },
      data: {
        availablePaise: { decrement: input.amountPaise },
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      // Distinguish wallet-not-found from insufficient-funds
      const existing = await tx.wallet.findUnique({
        where: { ownerUserId: input.ownerUserId },
      });
      if (!existing || existing.deletedAt) throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
      throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Insufficient available balance');
    }

    // Re-read wallet to get the walletId for the transaction record
    const wallet = await tx.wallet.findUnique({ where: { ownerUserId: input.ownerUserId } });

    const txn = await tx.transaction.create({
      data: {
        mongoId: new Types.ObjectId().toString(),
        idempotencyKey: input.idempotencyKey,
        type: input.type as any,
        status: 'completed',
        amountPaise: input.amountPaise,
        currency: 'INR',
        walletId: wallet?.id,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        orderId: input.orderId,
        campaignId: input.campaignId,
        payoutId: input.payoutId,
        metadata: input.metadata as any,
      },
    });

    return txn;
  };

  // If the caller provides an external tx, run within it (no new transaction).
  if (input.tx) {
    const result = await execute(input.tx);
    writeAuditLog({ action: 'WALLET_DEBIT', entityType: 'Wallet', entityId: input.ownerUserId, metadata: { amountPaise: input.amountPaise, type: input.type, idempotencyKey: input.idempotencyKey } });
    return result;
  }

  const db = prisma();
  const result = await db.$transaction(async (tx) => execute(tx));
  writeAuditLog({ action: 'WALLET_DEBIT', entityType: 'Wallet', entityId: input.ownerUserId, metadata: { amountPaise: input.amountPaise, type: input.type, idempotencyKey: input.idempotencyKey } });
  return result;
}
