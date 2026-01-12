import type { Request } from 'express';
import { AuditLogModel } from '../models/AuditLog.js';

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
    });
  } catch {
    // Audit logs must never break business flows.
  }
}
