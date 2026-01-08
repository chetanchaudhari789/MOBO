import type { ClientSession } from 'mongoose';
import { InviteModel } from '../models/Invite.js';
import { UserModel } from '../models/User.js';
import { AppError } from '../middleware/errors.js';

async function ensureActiveUserById(userId: any, session?: ClientSession) {
  const user = await UserModel.findById(userId).session(session ?? null).lean();
  if (!user) throw new AppError(400, 'INVITE_ISSUER_NOT_FOUND', 'Invite issuer not found');
  if ((user as any).deletedAt) {
    throw new AppError(400, 'INVITE_ISSUER_NOT_ACTIVE', 'Invite issuer is not active');
  }
  if ((user as any).status !== 'active') {
    throw new AppError(400, 'INVITE_ISSUER_NOT_ACTIVE', 'Invite issuer is not active');
  }
  return user as any;
}

async function ensureActiveUserByCode(params: { code: string; role: string }, session?: ClientSession) {
  const user = await UserModel.findOne({
    mediatorCode: params.code,
    roles: params.role,
    status: 'active',
    deletedAt: { $exists: false },
  })
    .session(session ?? null)
    .lean();
  if (!user) throw new AppError(400, 'INVITE_UPSTREAM_NOT_ACTIVE', 'Invite upstream is not active');
  return user as any;
}

async function enforceInviteIssuerAndUpstreamActive(invite: any, session?: ClientSession) {
  if (invite.createdBy) {
    await ensureActiveUserById(invite.createdBy, session);
  }

  if (invite.parentUserId) {
    const parent = await ensureActiveUserById(invite.parentUserId, session);

    // Enforce upstream lineage depending on invite type.
    if (invite.role === 'shopper') {
      if (!parent.roles?.includes('mediator') || !parent.mediatorCode) {
        throw new AppError(400, 'INVITE_PARENT_NOT_ACTIVE', 'Invite parent is not valid');
      }
      const agencyCode = String(parent.parentCode || '').trim();
      if (!agencyCode) {
        throw new AppError(400, 'INVITE_UPSTREAM_NOT_ACTIVE', 'Invite upstream is not valid');
      }
      await ensureActiveUserByCode({ code: agencyCode, role: 'agency' }, session);
    }

    if (invite.role === 'mediator') {
      if (!parent.roles?.includes('agency') || !parent.mediatorCode) {
        throw new AppError(400, 'INVITE_PARENT_NOT_ACTIVE', 'Invite parent is not valid');
      }
    }
  }
}

export async function consumeInvite(params: {
  code: string;
  role: string;
  usedByUserId: string;
  session?: ClientSession;
  requireActiveIssuer?: boolean;
}): Promise<any> {
  const now = new Date();

  const inviteSnapshot = await InviteModel.findOne({ code: params.code })
    .session(params.session ?? null)
    .lean();
  if (!inviteSnapshot) {
    throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
  }
  if (String((inviteSnapshot as any).role) !== String(params.role)) {
    throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
  }
  if ((inviteSnapshot as any).status !== 'active') {
    throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
  }
  if ((inviteSnapshot as any).expiresAt) {
    const exp = new Date((inviteSnapshot as any).expiresAt);
    if (exp.getTime() <= now.getTime()) {
      await InviteModel.updateOne(
        { _id: (inviteSnapshot as any)._id },
        { $set: { status: 'expired' } },
        { session: params.session ?? undefined }
      );
      throw new AppError(400, 'INVITE_EXPIRED', 'Invite has expired');
    }
  }
  if (Number((inviteSnapshot as any).useCount ?? 0) >= Number((inviteSnapshot as any).maxUses ?? 1)) {
    throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
  }

  if (params.requireActiveIssuer !== false) {
    await enforceInviteIssuerAndUpstreamActive(inviteSnapshot as any, params.session);
  }

  const invite = await InviteModel.findOneAndUpdate(
    {
      code: params.code,
      role: params.role,
      status: 'active',
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
      $expr: { $lt: ['$useCount', '$maxUses'] },
    } as any,
    [
      {
        $set: {
          useCount: { $add: ['$useCount', 1] },
          usedBy: params.usedByUserId as any,
          usedAt: now,
          uses: {
            $concatArrays: [
              { $ifNull: ['$uses', []] },
              [{ usedBy: params.usedByUserId as any, usedAt: now }],
            ],
          },
          status: {
            $cond: [
              { $gte: [{ $add: ['$useCount', 1] }, '$maxUses'] },
              'used',
              'active',
            ],
          },
        },
      },
    ] as any,
    { new: true, updatePipeline: true, session: params.session } as any
  );

  if (!invite) {
    // Could be revoked/expired/used due to a race.
    throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
  }

  return invite;
}

export async function revokeInvite(params: { code: string; revokedByUserId: string; reason?: string }) {
  const invite = await InviteModel.findOne({ code: params.code });
  if (!invite) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invite not found');
  if (invite.status !== 'active') throw new AppError(409, 'INVITE_NOT_ACTIVE', 'Invite is not active');

  invite.status = 'revoked';
  (invite as any).revokedBy = params.revokedByUserId as any;
  (invite as any).revokedAt = new Date();
  await invite.save();

  return invite;
}
