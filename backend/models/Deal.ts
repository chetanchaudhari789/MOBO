import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const DealTypes = ['Discount', 'Review', 'Rating'] as const;
export type DealType = (typeof DealTypes)[number];

const dealSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    mediatorCode: { type: String, required: true, trim: true, index: true },

    // Snapshot fields to keep published deals stable even if the campaign changes.
    title: { type: String, required: true, trim: true },
    description: { type: String, default: 'Exclusive', trim: true },
    image: { type: String, required: true, trim: true },
    productUrl: { type: String, required: true, trim: true },
    platform: { type: String, required: true, trim: true },
    brandName: { type: String, required: true, trim: true },

    dealType: { type: String, enum: DealTypes, required: true },

    originalPricePaise: { type: Number, required: true, min: 0 },
    pricePaise: { type: Number, required: true, min: 0 },
    commissionPaise: { type: Number, required: true, min: 0 },

    // CRITICAL: Mediator's payout from agency (commission + margin)
    // Margin = payoutPaise - commissionPaise
    payoutPaise: { type: Number, required: true, min: 0 },

    rating: { type: Number, default: 5, min: 0, max: 5 },
    category: { type: String, default: 'General', trim: true },

    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

dealSchema.index({ mediatorCode: 1, createdAt: -1 });
dealSchema.index({ campaignId: 1, mediatorCode: 1, deletedAt: 1 });

dealSchema.index(
  { campaignId: 1, mediatorCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: { $exists: false },
    },
  }
);

export type DealDoc = InferSchemaType<typeof dealSchema>;
export const DealModel = mongoose.model('Deal', dealSchema);
