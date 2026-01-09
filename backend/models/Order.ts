import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const OrderWorkflowStatuses = [
  'CREATED',
  'REDIRECTED',
  'ORDERED',
  'PROOF_SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'REWARD_PENDING',
  'COMPLETED',
  'FAILED',
] as const;
export type OrderWorkflowStatus = (typeof OrderWorkflowStatuses)[number];

export const OrderStatuses = ['Ordered', 'Shipped', 'Delivered', 'Cancelled', 'Returned'] as const;
export type OrderStatus = (typeof OrderStatuses)[number];

export const PaymentStatuses = ['Pending', 'Paid', 'Refunded', 'Failed'] as const;
export type PaymentStatus = (typeof PaymentStatuses)[number];

export const AffiliateStatuses = [
  'Unchecked',
  'Pending_Cooling',
  'Approved_Settled',
  'Rejected',
  'Fraud_Alert',
  'Cap_Exceeded',
  'Frozen_Disputed',
] as const;
export type AffiliateStatus = (typeof AffiliateStatuses)[number];

const orderItemSchema = new Schema(
  {
    productId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    image: { type: String, required: true, trim: true },

    priceAtPurchasePaise: { type: Number, required: true, min: 0 },
    commissionPaise: { type: Number, required: true, min: 0 },

    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    dealType: { type: String, trim: true },
    quantity: { type: Number, required: true, min: 1 },

    platform: { type: String, trim: true },
    brandName: { type: String, trim: true },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Brand ownership for secure filtering in brand portal.
    brandUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    items: { type: [orderItemSchema], required: true },

    totalPaise: { type: Number, required: true, min: 0 },

    // Strict workflow state machine (non-negotiable).
    workflowStatus: { type: String, enum: OrderWorkflowStatuses, default: 'CREATED', index: true },

    // Suspension freeze: once frozen, workflows do NOT auto-resume after unsuspension.
    frozen: { type: Boolean, default: false, index: true },
    frozenAt: { type: Date },
    frozenReason: { type: String, trim: true },
    reactivatedAt: { type: Date },
    reactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    status: { type: String, enum: OrderStatuses, default: 'Ordered', index: true },
    paymentStatus: { type: String, enum: PaymentStatuses, default: 'Pending', index: true },
    affiliateStatus: { type: String, enum: AffiliateStatuses, default: 'Unchecked', index: true },

    externalOrderId: { type: String, trim: true },

    // Optional payout/settlement reference (e.g., UTR) recorded during settlement.
    settlementRef: { type: String, trim: true },

    screenshots: {
      order: { type: String },
      payment: { type: String },
      review: { type: String },
      rating: { type: String },
    },
    reviewLink: { type: String, trim: true },

    managerName: { type: String, required: true, trim: true, index: true }, // mediatorCode
    agencyName: { type: String, trim: true },

    buyerName: { type: String, required: true, trim: true },
    buyerMobile: { type: String, required: true, trim: true },

    brandName: { type: String, trim: true },

    // Append-only event log for lifecycle auditing.
    events: [
      {
        type: { type: String, required: true, trim: true },
        at: { type: Date, required: true },
        actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
        metadata: { type: Schema.Types.Mixed },
      },
    ],

    expectedSettlementDate: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ managerName: 1, createdAt: -1 });
orderSchema.index({ brandUserId: 1, createdAt: -1 });

// Prevent duplicate marketplace orders system-wide (while allowing missing ids).
orderSchema.index(
  { externalOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalOrderId: { $type: 'string' },
      deletedAt: null,
    },
  }
);

// CRITICAL ANTI-FRAUD: One buyer can only have ONE active order per deal
// This prevents claiming the same deal multiple times
orderSchema.index(
  { userId: 1, 'items.0.productId': 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      workflowStatus: { $nin: ['FAILED', 'REJECTED'] },
    },
  }
);

export type OrderDoc = InferSchemaType<typeof orderSchema>;
export const OrderModel = mongoose.model('Order', orderSchema);
