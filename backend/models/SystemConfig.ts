import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const systemConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true, default: 'system' },
    adminContactEmail: { type: String, trim: true },
  },
  { timestamps: true }
);

export type SystemConfigDoc = InferSchemaType<typeof systemConfigSchema>;
export const SystemConfigModel = mongoose.model('SystemConfig', systemConfigSchema);
