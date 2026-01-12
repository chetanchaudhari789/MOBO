import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { Roles } from './User.js';

export const InviteStatus = ['active', 'used', 'revoked', 'expired'] as const;
export type InviteStatus = (typeof InviteStatus)[number];

const inviteSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, unique: true, index: true },

    role: { type: String, enum: Roles, required: true, index: true },
    label: { type: String, trim: true },

    parentUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    parentCode: { type: String, trim: true, index: true },

    status: { type: String, enum: InviteStatus, default: 'active', index: true },

    // Controlled-use invites (default single-use).
    maxUses: { type: Number, default: 1, min: 1 },
    useCount: { type: Number, default: 0, min: 0 },

    expiresAt: { type: Date }, // Removed index: true (defined in compound indexes below)

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    usedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    usedAt: { type: Date },

    // Full usage log for auditing (supports maxUses > 1).
    uses: [
      {
        usedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
        usedAt: { type: Date, required: true },
      },
    ],

    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

inviteSchema.index({ status: 1, expiresAt: 1 });
inviteSchema.index({ code: 1, status: 1, useCount: 1 });
inviteSchema.index({ parentCode: 1, status: 1, createdAt: -1 });

// TTL index: auto-delete expired invites 30 days after expiration
inviteSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 2592000, // 30 days
    partialFilterExpression: { status: 'expired' },
  }
);

export type InviteDoc = InferSchemaType<typeof inviteSchema>;
export const InviteModel = mongoose.model('Invite', inviteSchema);
