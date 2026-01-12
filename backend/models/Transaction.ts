import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const TransactionType = [
  'brand_deposit',
  'platform_fee',
  'commission_lock',
  'commission_settle',
  'cashback_lock',
  'cashback_settle',
  'order_settlement_debit',
  'agency_payout',
  'agency_receipt',
  'payout_request',
  'payout_complete',
  'payout_failed',
  'refund',
] as const;
export type TransactionType = (typeof TransactionType)[number];

export const TransactionStatus = ['pending', 'completed', 'failed', 'reversed'] as const;
export type TransactionStatus = (typeof TransactionStatus)[number];

const transactionSchema = new Schema(
  {
    // idempotency is mandatory for money-moving operations
    idempotencyKey: { type: String, required: true, trim: true },

    type: { type: String, enum: TransactionType, required: true, index: true },
    status: { type: String, enum: TransactionStatus, default: 'pending', index: true },

    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },

    // optional linkage fields
    orderId: { type: String, trim: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', index: true },
    payoutId: { type: Schema.Types.ObjectId, ref: 'Payout', index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', index: true },

    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    metadata: { type: Schema.Types.Mixed },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

transactionSchema.index({ status: 1, type: 1, createdAt: -1 });
transactionSchema.index({ deletedAt: 1, createdAt: -1 });
transactionSchema.index({ walletId: 1, createdAt: -1 });

transactionSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;
export const TransactionModel = mongoose.model('Transaction', transactionSchema);
