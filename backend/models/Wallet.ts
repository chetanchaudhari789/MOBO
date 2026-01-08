import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const Currency = ['INR'] as const;
export type Currency = (typeof Currency)[number];

const walletSchema = new Schema(
  {
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    currency: { type: String, enum: Currency, default: 'INR' },

    availablePaise: { type: Number, default: 0, min: 0 },
    pendingPaise: { type: Number, default: 0, min: 0 },
    lockedPaise: { type: Number, default: 0, min: 0 },

    // optimistic concurrency for business operations (separate from __v)
    version: { type: Number, default: 0, min: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

walletSchema.index({ deletedAt: 1, createdAt: -1 });

export type WalletDoc = InferSchemaType<typeof walletSchema>;
export const WalletModel = mongoose.model('Wallet', walletSchema);
