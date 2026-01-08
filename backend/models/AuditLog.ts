import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorRoles: [{ type: String, trim: true }],

    action: { type: String, required: true, trim: true, index: true },

    entityType: { type: String, trim: true, index: true },
    entityId: { type: String, trim: true, index: true },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },

    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1, action: 1 });

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);
