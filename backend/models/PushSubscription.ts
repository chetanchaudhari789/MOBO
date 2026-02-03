import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const pushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    app: { type: String, enum: ['buyer', 'mediator'], required: true, index: true },
    endpoint: { type: String, required: true, trim: true, unique: true },
    expirationTime: { type: Number },
    keys: {
      p256dh: { type: String, required: true, trim: true },
      auth: { type: String, required: true, trim: true },
    },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ userId: 1, app: 1 });

export type PushSubscriptionDoc = InferSchemaType<typeof pushSubscriptionSchema>;
export const PushSubscriptionModel = mongoose.model('PushSubscription', pushSubscriptionSchema);
