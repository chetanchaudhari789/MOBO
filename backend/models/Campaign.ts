import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const CampaignStatus = ['draft', 'active', 'paused', 'completed'] as const;
export type CampaignStatus = (typeof CampaignStatus)[number];

export const CampaignDealTypes = ['Discount', 'Review', 'Rating'] as const;
export type CampaignDealType = (typeof CampaignDealTypes)[number];

const campaignSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },

    brandUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    brandName: { type: String, required: true, trim: true, maxlength: 200 },

    platform: { type: String, required: true, trim: true, maxlength: 80 },

    image: { type: String, required: true, trim: true },
    productUrl: { type: String, required: true, trim: true },

    originalPricePaise: { type: Number, required: true, min: 0 },
    pricePaise: { type: Number, required: true, min: 0 },
    payoutPaise: { type: Number, required: true, min: 0 },

    returnWindowDays: { type: Number, default: 14, min: 0, max: 365 },

    // Optional UI field used to drive proof requirements.
    dealType: { type: String, enum: CampaignDealTypes },

    totalSlots: { type: Number, required: true, min: 0 },
    usedSlots: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: CampaignStatus, default: 'draft', index: true },

    // Agencies allowed to view campaign in their portal
    allowedAgencyCodes: [{ type: String, trim: true, index: true }],

    // Slot assignments for a code (agency or mediator)
    // CRITICAL: Must store { limit: number, payout?: number } not just numbers
    // limit = slots assigned, payout = custom payout override for this assignment
    assignments: {
      type: Map,
      of: new Schema(
        {
          limit: { type: Number, required: true, min: 0 },
          payout: { type: Number, min: 0 }, // Optional override; defaults to campaign.payoutPaise
        },
        { _id: false }
      ),
      default: {},
    },

    // IMMUTABILITY FLAG: Once locked, no changes to price/payout/slots allowed
    locked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date },
    lockedReason: { type: String, trim: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

campaignSchema.index({ status: 1, brandUserId: 1, createdAt: -1 });
campaignSchema.index({ deletedAt: 1, createdAt: -1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema>;
export const CampaignModel = mongoose.model('Campaign', campaignSchema);
