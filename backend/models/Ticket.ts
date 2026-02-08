import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const TicketStatuses = ['Open', 'Resolved', 'Rejected'] as const;
export type TicketStatus = (typeof TicketStatuses)[number];

const ticketSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },

    orderId: { type: String, trim: true, index: true },

    issueType: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    status: { type: String, enum: TicketStatuses, default: 'Open', index: true },

    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 1000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ticketSchema.index({ status: 1, createdAt: -1 });

export type TicketDoc = InferSchemaType<typeof ticketSchema>;
export const TicketModel = mongoose.model('Ticket', ticketSchema);
