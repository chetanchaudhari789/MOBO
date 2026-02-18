/**
 * Mongoose post-hooks that automatically fire dual-write to PostgreSQL.
 *
 * Call `registerDualWriteHooks()` **once** after Mongoose models are loaded
 * and the Prisma client is connected. Every subsequent Mongoose save /
 * findOneAndUpdate / findByIdAndUpdate / delete triggers a shadow PG upsert
 * via the dualWrite service. Failures are logged and never propagate.
 *
 * Hooks registered:
 * - `post('save')`             → fires on `.save()` and `Model.create()`
 * - `post('findOneAndUpdate')` → fires on `findOneAndUpdate()` / `findByIdAndUpdate()`
 * - `post('insertMany')`       → fires on `Model.insertMany()`
 * - `post('findOneAndDelete')` → fires on `findOneAndDelete()` / `findByIdAndDelete()`
 * - `post('deleteOne')`        → hard-deletes from PG via mongoId
 *
 * For bulk ops (`updateMany`, `deleteMany`) the
 * `resyncAfterBulkUpdate()` helper is exported so controllers can call it
 * explicitly after the Mongo mutation. The backfill script also catches any
 * remaining drift.
 *
 * NOTE: All dual-write operations use fire-and-forget pattern with silent error
 * swallowing to prevent breaking MongoDB operations. Consider implementing error
 * metrics or a dead-letter queue for production monitoring and reconciliation.
 * The backfill script can be used to sync documents that failed during normal operations.
 */

import { getPrisma, isPrismaAvailable } from '../database/prisma.js';

import { UserModel } from '../models/User.js';
import { BrandModel } from '../models/Brand.js';
import { AgencyModel } from '../models/Agency.js';
import { CampaignModel } from '../models/Campaign.js';
import { DealModel } from '../models/Deal.js';
import { OrderModel } from '../models/Order.js';
import { WalletModel } from '../models/Wallet.js';
import { TransactionModel } from '../models/Transaction.js';
import { PayoutModel } from '../models/Payout.js';
import { MediatorProfileModel } from '../models/MediatorProfile.js';
import { ShopperProfileModel } from '../models/ShopperProfile.js';
import { InviteModel } from '../models/Invite.js';
import { TicketModel } from '../models/Ticket.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { SuspensionModel } from '../models/Suspension.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { SystemConfigModel } from '../models/SystemConfig.js';

import {
  dualWriteUser,
  dualWriteBrand,
  dualWriteAgency,
  dualWriteCampaign,
  dualWriteDeal,
  dualWriteOrder,
  dualWriteWallet,
  dualWriteTransaction,
  dualWritePayout,
  dualWriteMediatorProfile,
  dualWriteShopperProfile,
  dualWriteInvite,
  dualWriteTicket,
  dualWritePushSubscription,
  dualWriteSuspension,
  dualWriteAuditLog,
  dualWriteSystemConfig,
} from '../services/dualWrite.js';

type HookEntry = {
  model: any;
  writer: (doc: any) => Promise<void>;
  label: string;
  /** Prisma delegate name for hard-delete operations */
  prismaDelegate: string;
};

const HOOKS: HookEntry[] = [
  { model: UserModel, writer: dualWriteUser, label: 'User', prismaDelegate: 'user' },
  { model: BrandModel, writer: dualWriteBrand, label: 'Brand', prismaDelegate: 'brand' },
  { model: AgencyModel, writer: dualWriteAgency, label: 'Agency', prismaDelegate: 'agency' },
  { model: CampaignModel, writer: dualWriteCampaign, label: 'Campaign', prismaDelegate: 'campaign' },
  { model: DealModel, writer: dualWriteDeal, label: 'Deal', prismaDelegate: 'deal' },
  { model: OrderModel, writer: dualWriteOrder, label: 'Order', prismaDelegate: 'order' },
  { model: WalletModel, writer: dualWriteWallet, label: 'Wallet', prismaDelegate: 'wallet' },
  { model: TransactionModel, writer: dualWriteTransaction, label: 'Transaction', prismaDelegate: 'transaction' },
  { model: PayoutModel, writer: dualWritePayout, label: 'Payout', prismaDelegate: 'payout' },
  { model: MediatorProfileModel, writer: dualWriteMediatorProfile, label: 'MediatorProfile', prismaDelegate: 'mediatorProfile' },
  { model: ShopperProfileModel, writer: dualWriteShopperProfile, label: 'ShopperProfile', prismaDelegate: 'shopperProfile' },
  { model: InviteModel, writer: dualWriteInvite, label: 'Invite', prismaDelegate: 'invite' },
  { model: TicketModel, writer: dualWriteTicket, label: 'Ticket', prismaDelegate: 'ticket' },
  { model: PushSubscriptionModel, writer: dualWritePushSubscription, label: 'PushSubscription', prismaDelegate: 'pushSubscription' },
  { model: SuspensionModel, writer: dualWriteSuspension, label: 'Suspension', prismaDelegate: 'suspension' },
  { model: AuditLogModel, writer: dualWriteAuditLog, label: 'AuditLog', prismaDelegate: 'auditLog' },
  { model: SystemConfigModel, writer: dualWriteSystemConfig, label: 'SystemConfig', prismaDelegate: 'systemConfig' },
];

/** Map from Mongoose model name → HookEntry, used by resyncAfterBulkUpdate */
const HOOK_MAP = new Map<string, HookEntry>();
for (const h of HOOKS) HOOK_MAP.set(h.label, h);

let registered = false;

function isDualWriteEnabled(): boolean {
  if (!isPrismaAvailable()) return false;
  const flag = process.env.DUAL_WRITE_ENABLED;
  return flag === 'true' || flag === '1';
}

/**
 * After a Mongoose `updateMany` or `deleteMany`, re-query affected documents
 * and dual-write each one to PG. Call this explicitly in controllers/services
 * after bulk MongoDB mutations.
 *
 * @param modelName  – Matches the label, e.g. 'Campaign', 'Deal', 'Order'
 * @param filter     – The same Mongoose filter used in updateMany / deleteMany
 * @param limit      – Max docs to re-sync (default 5000, safety valve)
 */
export async function resyncAfterBulkUpdate(
  modelName: string,
  filter: Record<string, unknown>,
  limit = 5000,
): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const entry = HOOK_MAP.get(modelName);
  if (!entry) {
    console.warn(`[dual-write-hooks] resyncAfterBulkUpdate: unknown model "${modelName}"`);
    return;
  }

  try {
    const total = await entry.model.countDocuments(filter);
    if (total > limit) {
      console.warn(
        `[dual-write-hooks] resyncAfterBulkUpdate(${modelName}): ${total} documents match filter,` +
          ` but only the first ${limit} will be re-synced. Consider using a smaller batch or pagination.`,
      );
    }

    const docs = await entry.model.find(filter).limit(limit).lean();
    const results = await Promise.allSettled(docs.map((d: any) => entry.writer(d)));
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures > 0) {
      console.error(`[dual-write-hooks] resyncAfterBulkUpdate(${modelName}): ${failures}/${docs.length} failed`);
    }
  } catch (err: any) {
    console.error(`[dual-write-hooks] resyncAfterBulkUpdate(${modelName}) error:`, err?.message ?? err);
  }
}

/**
 * Hard-delete a single document from PG by its Mongo ObjectId string.
 * Used by post('findOneAndDelete') and post('deleteOne') hooks.
 */
async function hardDeleteFromPg(label: string, prismaDelegate: string, mongoId: string): Promise<void> {
  if (!isDualWriteEnabled()) return;
  const db = getPrisma();
  if (!db) return;

  try {
    await (db as any)[prismaDelegate].deleteMany({ where: { mongoId } });
  } catch (err: any) {
    console.error(`[dual-write-hooks][${label}] hard-delete from PG failed:`, err?.message ?? err);
  }
}

/**
 * Register Mongoose post-hooks for dual-write on all models.
 * Safe to call multiple times — only registers once.
 */
export function registerDualWriteHooks(): void {
  if (registered) return;
  registered = true;

  for (const { model, writer, label, prismaDelegate } of HOOKS) {
    const schema = model.schema;
    if (!schema) {
      console.warn(`[dual-write-hooks] No schema found for ${label}, skipping`);
      continue;
    }

    // ── post('save') — covers .save() and Model.create() ──
    schema.post('save', function (doc: any) {
      writer(doc).catch((err: any) => {
        console.error(`[dual-write-hooks][${label}] post-save failed:`, err?.message ?? err);
      });
    });

    // ── post('findOneAndUpdate') — covers findOneAndUpdate, findByIdAndUpdate ──
    schema.post('findOneAndUpdate', function (doc: any) {
      if (!doc) return;
      writer(doc).catch((err: any) => {
        console.error(`[dual-write-hooks][${label}] post-findOneAndUpdate failed:`, err?.message ?? err);
      });
    });

    // ── post('insertMany') — covers bulk inserts ──
    schema.post('insertMany', function (docs: any[]) {
      if (!Array.isArray(docs)) return;
      for (const doc of docs) {
        writer(doc).catch((err: any) => {
          console.error(`[dual-write-hooks][${label}] post-insertMany failed:`, err?.message ?? err);
        });
      }
    });

    // ── post('findOneAndDelete') — covers findOneAndDelete / findByIdAndDelete ──
    schema.post('findOneAndDelete', function (doc: any) {
      if (!doc) return;
      const id = String(doc._id ?? '');
      if (!id) return;
      hardDeleteFromPg(label, prismaDelegate, id).catch((err: any) => {
        console.error(`[dual-write-hooks][${label}] post-findOneAndDelete failed:`, err?.message ?? err);
      });
    });

    // ── post('deleteOne') — covers document.deleteOne() ──
    schema.post('deleteOne', { document: true, query: false }, function (this: any) {
      const id = String(this._id ?? '');
      if (!id) return;
      hardDeleteFromPg(label, prismaDelegate, id).catch((err: any) => {
        console.error(`[dual-write-hooks][${label}] post-deleteOne failed:`, err?.message ?? err);
      });
    });
  }

  console.log('[dual-write-hooks] Registered post-hooks on all 17 models (save, update, insert, delete)');
}
