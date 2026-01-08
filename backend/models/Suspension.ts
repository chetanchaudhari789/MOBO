import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const SuspensionActions = ['suspend', 'unsuspend'] as const;
export type SuspensionAction = (typeof SuspensionActions)[number];

const suspensionSchema = new Schema(
  {
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, enum: SuspensionActions, required: true, index: true },
    reason: { type: String, trim: true },
    adminUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

suspensionSchema.index({ targetUserId: 1, createdAt: -1 });

export type SuspensionDoc = InferSchemaType<typeof suspensionSchema>;
export const SuspensionModel = mongoose.model('Suspension', suspensionSchema);
