import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const shopperProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    // future-proof fields; keep minimal now
    defaultMediatorCode: { type: String, trim: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export type ShopperProfileDoc = InferSchemaType<typeof shopperProfileSchema>;
export const ShopperProfileModel = mongoose.model('ShopperProfile', shopperProfileSchema);
