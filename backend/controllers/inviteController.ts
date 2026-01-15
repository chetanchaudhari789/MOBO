import type { Request, Response, NextFunction } from 'express';
import { InviteModel } from '../models/Invite.js';
import { createInviteSchema, opsGenerateInviteSchema, revokeInviteSchema } from '../validations/invites.js';
import { generateHumanCode } from '../services/codes.js';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { writeAuditLog } from '../services/audit.js';
import { revokeInvite } from '../services/invites.js';
import type { Role } from '../middleware/auth.js';
import { publishRealtime } from '../services/realtimeHub.js';

export function makeInviteController() {
  return {
    adminCreateInvite: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createInviteSchema.parse(req.body);

        const ttlSeconds = body.ttlSeconds ?? 60 * 60 * 24 * 7;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

        let code = generateHumanCode('INV');
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await InviteModel.exists({ code });
          if (!exists) break;
          code = generateHumanCode('INV');
        }

        const createdBy = req.auth?.userId ? req.auth.userId : undefined;

        const invite = await InviteModel.create({
          code,
          role: body.role,
          label: body.label,
          parentUserId: body.parentUserId,
          parentCode: body.parentCode,
          maxUses: body.maxUses ?? 1,
          expiresAt,
          createdBy,
        });

        await writeAuditLog({
          req,
          action: 'INVITE_CREATED',
          entityType: 'Invite',
          entityId: String(invite._id),
          metadata: { code: invite.code, role: invite.role, parentCode: invite.parentCode, parentUserId: invite.parentUserId },
        });

        const privilegedRoles: Role[] = ['admin', 'ops'];
        publishRealtime({ type: 'invites.changed', ts: new Date().toISOString(), audience: { roles: privilegedRoles } });
        res.status(201).json({
          code: invite.code,
          role: invite.role,
          label: invite.label,
          status: invite.status,
          expiresAt: invite.expiresAt,
        });
      } catch (err) {
        next(err);
      }
    },

    adminRevokeInvite: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = revokeInviteSchema.parse(req.body);
        const revokedBy = req.auth?.userId;
        if (!revokedBy) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const invite = await revokeInvite({ code: body.code, revokedByUserId: revokedBy, reason: body.reason });

        await writeAuditLog({
          req,
          action: 'INVITE_REVOKED',
          entityType: 'Invite',
          entityId: String(invite._id),
          metadata: { code: invite.code, reason: body.reason },
        });

        const privilegedRoles: Role[] = ['admin', 'ops'];
        publishRealtime({ type: 'invites.changed', ts: new Date().toISOString(), audience: { roles: privilegedRoles } });
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },

    adminListInvites: async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const invites = await InviteModel.find({}).sort({ createdAt: -1 }).limit(500).lean();
        res.json(invites);
      } catch (err) {
        next(err);
      }
    },

    opsGenerateMediatorInvite: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = opsGenerateInviteSchema.parse(req.body);

        const requesterId = req.auth?.userId;
        if (!requesterId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const requester = await UserModel.findById(requesterId);
        if (!requester) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');

        // Allow agencies to generate mediator invites for themselves. Admin/Ops can generate for any agency.
        const isAgencySelf =
          requester.roles?.includes('agency') && String(requester._id) === body.agencyId;
        const isPrivileged = requester.roles?.includes('admin') || requester.roles?.includes('ops');
        if (!isAgencySelf && !isPrivileged) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot generate invites for this agency');
        }

        const agency = await UserModel.findById(body.agencyId);
        if (!agency || !agency.roles?.includes('agency')) {
          throw new AppError(404, 'AGENCY_NOT_FOUND', 'Agency not found');
        }

        // Ensure agency has a stable code.
        if (!agency.mediatorCode) {
          agency.mediatorCode = generateHumanCode('AGY');
          await agency.save();
        }

        let code = generateHumanCode('INV');
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await InviteModel.exists({ code });
          if (!exists) break;
          code = generateHumanCode('INV');
        }

        const invite = await InviteModel.create({
          code,
          role: 'mediator',
          parentUserId: agency._id,
          parentCode: agency.mediatorCode,
          createdBy: requester._id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        });

        await writeAuditLog({
          req,
          action: 'INVITE_CREATED',
          entityType: 'Invite',
          entityId: String(invite._id),
          metadata: { code: invite.code, role: invite.role, parentCode: invite.parentCode, parentUserId: invite.parentUserId },
        });

        const privilegedRoles: Role[] = ['admin', 'ops'];
        publishRealtime({ type: 'invites.changed', ts: new Date().toISOString(), audience: { roles: privilegedRoles } });
        res.status(201).json({ code: invite.code });
      } catch (err) {
        next(err);
      }
    },

    opsGenerateBuyerInvite: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const mediatorId = String((req.body?.mediatorId ?? '') as any).trim();
        if (!mediatorId) throw new AppError(400, 'INVALID_MEDIATOR_ID', 'mediatorId required');

        const requesterId = req.auth?.userId;
        if (!requesterId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');

        const requester = await UserModel.findById(requesterId);
        if (!requester) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');

        const isMediatorSelf = requester.roles?.includes('mediator') && String(requester._id) === mediatorId;
        const isPrivileged = requester.roles?.includes('admin') || requester.roles?.includes('ops');
        if (!isMediatorSelf && !isPrivileged) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot generate buyer invites for this mediator');
        }

        const mediator = await UserModel.findById(mediatorId);
        if (!mediator || !mediator.roles?.includes('mediator')) {
          throw new AppError(404, 'MEDIATOR_NOT_FOUND', 'Mediator not found');
        }
        if (!mediator.mediatorCode) {
          throw new AppError(409, 'MISSING_MEDIATOR_CODE', 'Mediator missing code');
        }

        let code = generateHumanCode('INV');
        for (let i = 0; i < 5; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const exists = await InviteModel.exists({ code });
          if (!exists) break;
          code = generateHumanCode('INV');
        }

        const invite = await InviteModel.create({
          code,
          role: 'shopper',
          parentUserId: mediator._id,
          parentCode: mediator.mediatorCode,
          createdBy: requester._id,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        });

        await writeAuditLog({
          req,
          action: 'INVITE_CREATED',
          entityType: 'Invite',
          entityId: String(invite._id),
          metadata: { code: invite.code, role: invite.role, parentCode: invite.parentCode, parentUserId: invite.parentUserId },
        });

        const privilegedRoles: Role[] = ['admin', 'ops'];
        publishRealtime({ type: 'invites.changed', ts: new Date().toISOString(), audience: { roles: privilegedRoles } });
        res.status(201).json({ code: invite.code });
      } catch (err) {
        next(err);
      }
    },
  };
}
