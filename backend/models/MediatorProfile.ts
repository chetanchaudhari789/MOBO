import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const MediatorStatus = ['active', 'suspended', 'pending'] as const;
export type MediatorStatus = (typeof MediatorStatus)[number];

const mediatorProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    mediatorCode: { type: String, required: true, unique: true, trim: true, index: true },
    parentAgencyCode: { type: String, trim: true, index: true },

    status: { type: String, enum: MediatorStatus, default: 'active', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export type MediatorProfileDoc = InferSchemaType<typeof mediatorProfileSchema>;
export const MediatorProfileModel = mongoose.model('MediatorProfile', mediatorProfileSchema);
