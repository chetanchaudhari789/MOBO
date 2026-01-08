import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const BrandStatus = ['active', 'suspended', 'pending'] as const;
export type BrandStatus = (typeof BrandStatus)[number];

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    brandCode: { type: String, required: true, unique: true, trim: true, index: true },

    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    connectedAgencyCodes: [{ type: String, trim: true, index: true }],

    status: { type: String, enum: BrandStatus, default: 'active', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

brandSchema.index({ status: 1, createdAt: -1 });

export type BrandDoc = InferSchemaType<typeof brandSchema>;
export const BrandModel = mongoose.model('Brand', brandSchema);
