import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const AgencyStatus = ['active', 'suspended', 'pending'] as const;
export type AgencyStatus = (typeof AgencyStatus)[number];

const agencySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    agencyCode: { type: String, required: true, unique: true, trim: true, index: true },

    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    status: { type: String, enum: AgencyStatus, default: 'active', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

agencySchema.index({ status: 1, createdAt: -1 });

export type AgencyDoc = InferSchemaType<typeof agencySchema>;
export const AgencyModel = mongoose.model('Agency', agencySchema);
