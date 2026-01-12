import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { normalizeMobileTo10Digits } from '../utils/mobiles.js';

export const Roles = ['shopper', 'mediator', 'agency', 'brand', 'admin', 'ops'] as const;
export type Role = (typeof Roles)[number];

export const UserStatus = ['active', 'suspended', 'pending'] as const;
export type UserStatus = (typeof UserStatus)[number];

const bankDetailsSchema = new Schema(
  {
    accountNumber: { type: String, trim: true },
    ifsc: { type: String, trim: true },
    bankName: { type: String, trim: true },
    holderName: { type: String, trim: true },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },

    // Optional login identifier (used for admin username/password login).
    // Normal users still authenticate via mobile.
    username: {
      type: String,
      trim: true,
      lowercase: true,
      minlength: 2,
      maxlength: 64,
      index: true,
      unique: true,
      sparse: true,
    },

    mobile: { type: String, required: true, trim: true, match: /^\d{10}$/ },
    email: { type: String, trim: true, lowercase: true },

    // Never store plaintext passwords
    passwordHash: { type: String, required: true },

    // Keep a legacy single-role field for backwards compatibility while enabling multi-role.
    role: { type: String, enum: Roles, default: 'shopper', index: true },
    roles: { type: [String], enum: Roles, default: ['shopper'], index: true },

    status: { type: String, enum: UserStatus, default: 'active', index: true },

    // --- Ops hierarchy / attribution ---
    mediatorCode: { type: String, trim: true },
    parentCode: { type: String, trim: true, index: true },
    generatedCodes: [{ type: String, trim: true }],

    // --- Consumer specific ---
    isVerifiedByMediator: { type: Boolean, default: false },

    // --- Brand specific ---
    brandCode: { type: String, trim: true },
    connectedAgencies: { type: [{ type: String, trim: true }], default: [] },
    pendingConnections: [
      {
        agencyId: { type: String, trim: true },
        agencyName: { type: String, trim: true },
        agencyCode: { type: String, trim: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // --- KYC ---
    kycStatus: {
      type: String,
      enum: ['none', 'pending', 'verified', 'rejected'],
      default: 'none',
      index: true,
    },
    kycDocuments: {
      panCard: { type: String, trim: true },
      aadhaar: { type: String, trim: true },
      gst: { type: String, trim: true },
    },

    // --- Financials ---
    upiId: { type: String, trim: true },
    qrCode: { type: String, trim: true },
    bankDetails: { type: bankDetailsSchema },

    walletBalancePaise: { type: Number, default: 0, min: 0 },
    walletPendingPaise: { type: Number, default: 0, min: 0 },

    // --- Meta ---
    avatar: { type: String, trim: true },

    // --- Audit / soft delete ---
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

(userSchema as any).pre('validate', function ensureRoles(this: any) {
  if (this.mobile != null) {
    this.mobile = normalizeMobileTo10Digits(this.mobile);
  }

  if (!this.roles || this.roles.length === 0) {
    this.roles = [this.role as Role];
  }
  if (this.role && !this.roles.includes(this.role)) {
    this.roles = Array.from(new Set([this.role, ...this.roles]));
  }

  // Normalize and dedupe connection arrays (arrays can accumulate duplicates under retries)
  if (Array.isArray(this.connectedAgencies)) {
    const cleaned = this.connectedAgencies
      .map((v: unknown) => String(v ?? '').trim())
      .filter(Boolean);
    this.connectedAgencies = Array.from(new Set(cleaned));
  }

  if (Array.isArray(this.pendingConnections)) {
    const byCode = new Map<string, any>();
    for (const entry of this.pendingConnections) {
      const code = String(entry?.agencyCode ?? '').trim();
      if (!code) continue;
      const prev = byCode.get(code);
      if (!prev) {
        byCode.set(code, entry);
      } else {
        const prevTs = prev?.timestamp ? new Date(prev.timestamp).getTime() : 0;
        const nextTs = entry?.timestamp ? new Date(entry.timestamp).getTime() : 0;
        if (nextTs > prevTs) byCode.set(code, entry);
      }
    }
    this.pendingConnections = Array.from(byCode.values());
  }
});

// Uniqueness + query indexes should respect soft delete.
userSchema.index(
  { mobile: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
  }
);

// Optional email should be unique when present (and not deleted)
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      email: { $type: 'string' },
    },
  }
);

// Compound indexes for efficient role-based queries
userSchema.index({ brandCode: 1, roles: 1, deletedAt: 1 });
userSchema.index({ mediatorCode: 1, roles: 1, deletedAt: 1 });
userSchema.index({ roles: 1, status: 1, deletedAt: 1 });

userSchema.index(
  { mediatorCode: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null, mediatorCode: { $type: 'string' } },
  }
);

userSchema.index(
  { brandCode: 1 },
  {
    partialFilterExpression: { deletedAt: null, brandCode: { $type: 'string' } },
  }
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export const UserModel = mongoose.model('User', userSchema);
