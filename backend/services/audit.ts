import type { Request } from 'express';
import { AuditLogModel } from '../models/AuditLog.js';
import { dualWriteAuditLog } from './dualWrite.js';

export type AuditParams = {
  req?: Request;
  actorUserId?: string;
  actorRoles?: string[];
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: any;
};

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    const actorUserId = params.actorUserId ?? params.req?.auth?.userId;
    const actorRoles = params.actorRoles ?? params.req?.auth?.roles;

    await AuditLogModel.create({
      actorUserId: actorUserId || undefined,
      actorRoles: Array.isArray(actorRoles) ? actorRoles : undefined,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ip: params.req?.ip,
      userAgent: params.req?.header('user-agent') || undefined,
      metadata: params.metadata,
    }).then((doc) => {
      // Dual-write audit log to PG (fire-and-forget, no await)
      dualWriteAuditLog(doc).catch(() => {});
    });
  } catch (err) {
    // Audit logs must never break business flows, but we log failures
    // so security-relevant events are not silently lost.
    console.error('[audit] Failed to write audit log:', params.action, params.entityType, params.entityId, err);
  }
}
