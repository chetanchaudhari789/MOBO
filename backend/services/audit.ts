import type { Request } from 'express';
import { Types } from 'mongoose';
import { prisma, isPrismaAvailable } from '../database/prisma.js';
import { AuditLogModel } from '../models/AuditLog.js';
import logger from '../config/logger.js';

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
    const pgActorUserId = (params.req?.auth as any)?.pgUserId;
    const actorRoles = params.actorRoles ?? params.req?.auth?.roles;
    const mongoId = new Types.ObjectId().toString();

    if (isPrismaAvailable()) {
      // Primary: write to PostgreSQL
      const db = prisma();
      await db.auditLog.create({
        data: {
          mongoId,
          actorUserId: pgActorUserId || undefined,
          actorRoles: Array.isArray(actorRoles) ? (actorRoles as string[]) : [],
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          ip: params.req?.ip,
          userAgent: params.req?.header('user-agent') || undefined,
          metadata: params.metadata ?? undefined,
        },
      });
    }

    // Secondary: fire-and-forget write to MongoDB
    AuditLogModel.create({
      _id: mongoId,
      actorUserId: actorUserId || undefined,
      actorRoles: Array.isArray(actorRoles) ? actorRoles : undefined,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ip: params.req?.ip,
      userAgent: params.req?.header('user-agent') || undefined,
      metadata: params.metadata,
    }).catch(() => {});
  } catch (err) {
    // Audit logs must never break business flows, but we log failures
    // so security-relevant events are not silently lost.
    logger.error('[audit] Failed to write audit log', { action: params.action, entityType: params.entityType, entityId: params.entityId, error: err });
  }
}
