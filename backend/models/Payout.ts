import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const PayoutStatus = ['requested', 'processing', 'paid', 'failed', 'canceled'] as const;
export type PayoutStatus = (typeof PayoutStatus)[number];

const payoutSchema = new Schema(
  {
    beneficiaryUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },

    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },

    status: { type: String, enum: PayoutStatus, default: 'requested', index: true },

    provider: { type: String, trim: true },
    providerRef: { type: String, trim: true, index: true, sparse: true },

    failureCode: { type: String, trim: true },
    failureMessage: { type: String, trim: true },

    requestedAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

payoutSchema.index({ status: 1, requestedAt: -1 });
payoutSchema.index({ beneficiaryUserId: 1, requestedAt: -1 });

export type PayoutDoc = InferSchemaType<typeof payoutSchema>;
export const PayoutModel = mongoose.model('Payout', payoutSchema);
