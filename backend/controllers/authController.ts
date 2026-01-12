import type { Request, Response, NextFunction } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../middleware/errors.js';
import { UserModel } from '../models/User.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import type { Env } from '../config/env.js';
import { signAccessToken, signRefreshToken } from '../services/tokens.js';
import {
  loginSchema,
  registerBrandSchema,
  registerOpsSchema,
  registerSchema,
  updateProfileSchema,
} from '../validations/auth.js';
import { InviteModel } from '../models/Invite.js';
import { generateHumanCode } from '../services/codes.js';
import { writeAuditLog } from '../services/audit.js';
import { consumeInvite } from '../services/invites.js';
import { ensureWallet } from '../services/walletService.js';
import { toUiUser } from '../utils/uiMappers.js';
<<<<<<< HEAD
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { publishBroadcast, publishRealtime } from '../services/realtimeHub.js';
import { getAgencyCodeForMediatorCode } from '../services/lineage.js';
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

export function makeAuthController(env: Env) {
  async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        out = await fn(session);
      });
      return out;
    } finally {
      session.endSession();
    }
  }

  return {
    me: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = String(req.auth?.userId || '').trim();
        if (!userId) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
        }

        const user = await UserModel.findById(userId);
        if (!user || (user as any).deletedAt) {
          throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        }

        // `requireAuth` already enforces active status + upstream suspension.

        const wallet = await ensureWallet(String((user as any)._id));
        res.json({ user: toUiUser(user, wallet) });
      } catch (err) {
        next(err);
      }
    },

    register: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerSchema.parse(req.body);

<<<<<<< HEAD
        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
=======
        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

<<<<<<< HEAD
        // Atomic: validate + create user + (optional) consume invite.
        const { user, consumed } = await withTransaction(async (session) => {
          // Preferred: invite-based registration.
          const invite = await InviteModel.findOne({ code: body.mediatorCode, status: 'active' })
            .session(session)
            .lean();

          let upstreamMediatorCode = '';
          let consume: null | { code: string; role: string } = null;

          if (invite) {
            if (String((invite as any).role) !== 'shopper') {
              throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
            }
            const maxUses = Number((invite as any).maxUses ?? 1);
            const useCount = Number((invite as any).useCount ?? 0);
            if (useCount >= maxUses) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            upstreamMediatorCode = String((invite as any).parentCode || '').trim();
            if (!upstreamMediatorCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Invite missing parent mediator code');
            }
            consume = { code: body.mediatorCode, role: 'shopper' };
          } else {
            // Fallback: allow registering with an upstream mediator code directly.
            upstreamMediatorCode = String(body.mediatorCode || '').trim();
            if (!upstreamMediatorCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }
          }

          // Parent mediator must be active.
=======
        // Atomic: validate + create user + consume invite.
        const { user, consumed } = await withTransaction(async (session) => {
          const invite = await InviteModel.findOne({ code: body.mediatorCode }).session(session).lean();
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');

          const upstreamMediatorCode = String((invite as any).parentCode || '').trim();
          if (!upstreamMediatorCode) {
            throw new AppError(400, 'INVALID_INVITE', 'Invite missing parent mediator code');
          }

          // Parent mediator must be active; upstream agency enforcement happens inside consumeInvite.
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          const mediator = await UserModel.findOne({
            mediatorCode: upstreamMediatorCode,
            roles: 'mediator',
            status: 'active',
            deletedAt: null,
          })
            .session(session)
            .lean();
          if (!mediator) {
            throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent mediator is not valid');
          }

          const created = await UserModel.create(
            [
              {
                name: body.name,
                mobile: body.mobile,
                email: body.email,
                passwordHash,
                role: 'shopper',
                roles: ['shopper'],
                status: 'active',
                parentCode: upstreamMediatorCode,
                isVerifiedByMediator: false,
              },
            ],
            { session }
          );

          const newUser = created[0];

<<<<<<< HEAD
          await ensureRoleDocumentsForUser({ user: newUser, session });

          const consumedInvite = consume
            ? await consumeInvite({
                code: consume.code,
                role: consume.role,
                usedByUserId: String(newUser._id),
                session,
              })
            : null;
=======
          const consumedInvite = await consumeInvite({
            code: body.mediatorCode,
            role: 'shopper',
            usedByUserId: String(newUser._id),
            session,
          });
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

          return { user: newUser, consumed: consumedInvite };
        });

<<<<<<< HEAD
        if (consumed) {
          await writeAuditLog({
            req,
            action: 'INVITE_USED',
            entityType: 'Invite',
            entityId: String(consumed._id),
            metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
          });

          // Realtime: keep admin invite list accurate (status/useCount/usedAt).
          publishBroadcast('invites.changed', { code: consumed.code, role: consumed.role, status: consumed.status });
        }
=======
        await writeAuditLog({
          req,
          action: 'INVITE_USED',
          entityType: 'Invite',
          entityId: String(consumed._id),
          metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
        });
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));

<<<<<<< HEAD
        // Realtime: a buyer created via a mediator code must show up immediately in the mediator portal
        // for approve/reject workflows (and in the upstream agency view).
        const upstreamMediatorCode = String((user as any)?.parentCode || '').trim();
        if (upstreamMediatorCode) {
          const agencyCode = (await getAgencyCodeForMediatorCode(upstreamMediatorCode)) || '';
          const ts = new Date().toISOString();
          publishRealtime({
            type: 'users.changed',
            ts,
            payload: { userId: String(user._id), kind: 'buyer', mediatorCode: upstreamMediatorCode },
            audience: {
              mediatorCodes: [upstreamMediatorCode],
              ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
              roles: ['admin', 'ops'],
            },
          });
          publishRealtime({
            type: 'notifications.changed',
            ts,
            payload: { source: 'buyer.registered', userId: String(user._id) },
            audience: {
              mediatorCodes: [upstreamMediatorCode],
              ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
              roles: ['admin', 'ops'],
            },
          });
        }

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        res.status(201).json({
          user: toUiUser(user, wallet),
          tokens: { accessToken, refreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    login: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = loginSchema.parse(req.body);

<<<<<<< HEAD
        const password = (body as any).password;

        const mobile = typeof (body as any).mobile === 'string' ? String((body as any).mobile).trim() : '';
        const usernameRaw =
          typeof (body as any).username === 'string' ? String((body as any).username).trim() : '';
        const username = usernameRaw ? usernameRaw.toLowerCase() : '';

        const user = mobile
          ? await UserModel.findOne({ mobile, deletedAt: null })
          : await UserModel.findOne({ username, role: { $in: ['admin', 'ops'] }, deletedAt: null });
        if (!user) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }

        // Admin/ops must use username login (mobile is not accepted for these roles).
        if (mobile) {
          const primaryRole = String((user as any).role || '').toLowerCase();
          const roles = Array.isArray((user as any).roles) ? (user as any).roles.map((r: any) => String(r).toLowerCase()) : [];
          const isAdminOrOps = primaryRole === 'admin' || primaryRole === 'ops' || roles.includes('admin') || roles.includes('ops');
          if (isAdminOrOps) {
            throw new AppError(400, 'USERNAME_REQUIRED', 'Admin login requires username and password');
          }
        }
=======
        const user = await UserModel.findOne({ mobile: body.mobile });
        if (!user) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        if (user.status !== 'active') {
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

<<<<<<< HEAD
        const ok = await verifyPassword(password, user.passwordHash);
=======
        const ok = await verifyPassword(body.password, user.passwordHash);
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        if (!ok) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));

        res.json({
          user: toUiUser(user, wallet),
          tokens: { accessToken, refreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    registerOps: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerOpsSchema.parse(req.body);

<<<<<<< HEAD
        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
=======
        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

<<<<<<< HEAD
        const { user, consumed, pendingApproval } = await withTransaction(async (session) => {
          const isMediatorJoin = body.role === 'mediator';

          // Preferred: invite-based.
          const invite = await InviteModel.findOne({ code: body.code, status: 'active' })
            .session(session)
            .lean();

          let parentCode: string | undefined;
          let createdBy: any | undefined;
          let consume: null | { code: string; role: string } = null;
          let pendingApproval = false;

          if (invite) {
            if (String((invite as any).role) !== String(body.role)) {
              throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
            }
            const maxUses = Number((invite as any).maxUses ?? 1);
            const useCount = Number((invite as any).useCount ?? 0);
            if (useCount >= maxUses) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            parentCode = (invite as any).parentCode ?? undefined;
            createdBy = (invite as any).createdBy;
            consume = { code: body.code, role: body.role };
          } else {
            // Fallback: allow a mediator to join an agency using the agency's code.
            if (!isMediatorJoin) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            // This flow must NOT auto-activate the mediator. It should create a pending request
            // that the agency can approve/reject.
            pendingApproval = true;

            const agencyCode = String(body.code || '').trim();
            if (!agencyCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            const agency = await UserModel.findOne({
              mediatorCode: agencyCode,
              roles: 'agency',
              status: 'active',
              deletedAt: null,
            })
              .session(session)
              .lean();
            if (!agency) {
              throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent agency is not valid');
            }

            const agencyParentCode = String((agency as any).mediatorCode || '').trim();
            if (!agencyParentCode) {
              throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent agency is not valid');
            }
            parentCode = agencyParentCode;
          }

          if (body.role === 'mediator') {
            const agencyCode = String(parentCode || '').trim();
            if (!agencyCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Mediator join requires an agency code');
=======
        const { user, consumed } = await withTransaction(async (session) => {
          // Strict: ops/agency/mediator registration MUST be invite-based.
          const invite = await InviteModel.findOne({ code: body.code }).session(session).lean();
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          if (String((invite as any).role) !== String(body.role)) {
            throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
          }

          const parentCode: string | undefined = (invite as any).parentCode ?? undefined;

          if (body.role === 'mediator') {
            const agencyCode = String(parentCode || '').trim();
            if (!agencyCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Mediator invite missing parent agency code');
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
            }

            const agency = await UserModel.findOne({
              mediatorCode: agencyCode,
              roles: 'agency',
              status: 'active',
              deletedAt: null,
            })
              .session(session)
              .lean();
            if (!agency) {
              throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent agency is not valid');
            }
          }

          const roles = body.role === 'agency' ? (['agency'] as const) : (['mediator'] as const);
          const mediatorCodePrefix = body.role === 'agency' ? 'AGY' : 'MED';
          let mediatorCode = generateHumanCode(mediatorCodePrefix);
          for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const codeExists = await UserModel.exists({ mediatorCode }).session(session);
            if (!codeExists) break;
            mediatorCode = generateHumanCode(mediatorCodePrefix);
          }

          const created = await UserModel.create(
            [
              {
                name: body.name,
                mobile: body.mobile,
                passwordHash,
                role: body.role,
                roles: [...roles],
<<<<<<< HEAD
                status: pendingApproval ? 'pending' : 'active',
                mediatorCode,
                parentCode: parentCode,
                kycStatus: 'pending',
                createdBy,
=======
                status: 'active',
                mediatorCode,
                parentCode: parentCode,
                kycStatus: 'pending',
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
              },
            ],
            { session }
          );

          const newUser = created[0];

<<<<<<< HEAD
          await ensureRoleDocumentsForUser({ user: newUser, session });

          const consumedInvite = consume
            ? await consumeInvite({
                code: consume.code,
                role: consume.role,
                usedByUserId: String(newUser._id),
                session,
              })
            : null;

          return { user: newUser, consumed: consumedInvite, pendingApproval };
        });

        if (consumed) {
          await writeAuditLog({
            req,
            action: 'INVITE_USED',
            entityType: 'Invite',
            entityId: String(consumed._id),
            metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
          });

          publishBroadcast('invites.changed', { code: consumed.code, role: consumed.role, status: consumed.status });
        }

        // If mediator joined via agency code, the account is pending and must be approved by agency.
        if (pendingApproval) {
          // Realtime: agency portal must see mediator join requests instantly.
          const agencyCode = String((user as any)?.parentCode || '').trim();
          if (agencyCode) {
            const ts = new Date().toISOString();
            publishRealtime({
              type: 'users.changed',
              ts,
              payload: { userId: String(user._id), kind: 'mediator', status: 'pending', agencyCode },
              audience: { agencyCodes: [agencyCode], roles: ['admin', 'ops'] },
            });
            publishRealtime({
              type: 'notifications.changed',
              ts,
              payload: { source: 'mediator.join.requested', userId: String(user._id), agencyCode },
              audience: { agencyCodes: [agencyCode], roles: ['admin', 'ops'] },
            });
          }
          res.status(202).json({
            pendingApproval: true,
            message: 'Request sent to agency for approval',
          });
          return;
        }
=======
          const consumedInvite = await consumeInvite({
            code: body.code,
            role: body.role,
            usedByUserId: String(newUser._id),
            session,
          });

          return { user: newUser, consumed: consumedInvite };
        });

        await writeAuditLog({
          req,
          action: 'INVITE_USED',
          entityType: 'Invite',
          entityId: String(consumed._id),
          metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
        });
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

<<<<<<< HEAD
        const wallet = await ensureWallet(String(user._id));
        res.status(201).json({ user: toUiUser(user, wallet), tokens: { accessToken, refreshToken } });
=======
        res.status(201).json({
          user: {
            id: String(user._id),
            name: user.name,
            mobile: user.mobile,
            role: user.role,
            roles: user.roles,
            mediatorCode: user.mediatorCode,
            parentCode: user.parentCode,
          },
          tokens: { accessToken, refreshToken },
        });
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
      } catch (err) {
        next(err);
      }
    },

    registerBrand: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerBrandSchema.parse(req.body);

<<<<<<< HEAD
        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
=======
        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        const { user, consumed } = await withTransaction(async (session) => {
          // Brand registration MUST be invite-based.
          // The UI field is currently named `brandCode` but must contain an invite code.
<<<<<<< HEAD
          const invite = await InviteModel.findOne({ code: body.brandCode, status: 'active' })
            .session(session)
            .lean();
=======
          const invite = await InviteModel.findOne({ code: body.brandCode }).session(session).lean();
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          if (String((invite as any).role) !== 'brand') {
            throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
          }
<<<<<<< HEAD
          const maxUses = Number((invite as any).maxUses ?? 1);
          const useCount = Number((invite as any).useCount ?? 0);
          if (useCount >= maxUses) {
            throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          }
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

          // Generate a stable brand code for downstream linking (Brand -> Agency connections).
          let brandCode = generateHumanCode('BRD');
          for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const exists = await UserModel.exists({ brandCode }).session(session);
            if (!exists) break;
            brandCode = generateHumanCode('BRD');
          }

          const created = await UserModel.create(
            [
              {
                name: body.name,
                mobile: body.mobile,
                passwordHash,
                role: 'brand',
                roles: ['brand'],
                status: 'active',
                brandCode,
                createdBy: (invite as any).createdBy,
              },
            ],
            { session }
          );

          const newUser = created[0];

<<<<<<< HEAD
          await ensureRoleDocumentsForUser({ user: newUser, session });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
          const consumedInvite = await consumeInvite({
            code: body.brandCode,
            role: 'brand',
            usedByUserId: String(newUser._id),
            session,
          });

          return { user: newUser, consumed: consumedInvite };
        });

        await writeAuditLog({
          req,
          action: 'INVITE_USED',
          entityType: 'Invite',
          entityId: String(consumed._id),
          metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
        });

<<<<<<< HEAD
        publishBroadcast('invites.changed', { code: consumed.code, role: consumed.role, status: consumed.status });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));

        res.status(201).json({
          user: toUiUser(user, wallet),
          tokens: { accessToken, refreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    updateProfile: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = updateProfileSchema.parse(req.body);
        const requesterId = req.auth?.userId;
        if (!requesterId) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
        }

        const targetUserId = body.userId ?? requesterId;
        const requester = await UserModel.findById(requesterId);
        if (!requester) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');

        const isSelf = String(targetUserId) === String(requesterId);
        const isAdmin = requester.roles?.includes('admin') || requester.roles?.includes('ops');
        if (!isSelf && !isAdmin) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot update other user profile');
        }

        const update: any = {};
<<<<<<< HEAD

        for (const key of ['name', 'email', 'avatar', 'upiId', 'qrCode'] as const) {
          const value = (body as any)[key];
          if (typeof value === 'undefined') continue;
          if (typeof value === 'string' && value.trim() === '') continue;
          update[key] = value;
        }

        if (typeof (body as any).bankDetails !== 'undefined') {
          const raw = (body as any).bankDetails as any;
          if (raw && typeof raw === 'object') {
            const cleaned: any = {};
            for (const k of ['accountNumber', 'ifsc', 'bankName', 'holderName'] as const) {
              const v = raw[k];
              if (typeof v === 'undefined') continue;
              if (typeof v === 'string' && v.trim() === '') continue;
              cleaned[k] = v;
            }
            if (Object.keys(cleaned).length) update.bankDetails = cleaned;
          }
=======
        for (const key of ['name', 'email', 'avatar', 'upiId', 'qrCode', 'bankDetails'] as const) {
          if (typeof (body as any)[key] !== 'undefined') update[key] = (body as any)[key];
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        }

        const user = await UserModel.findByIdAndUpdate(targetUserId, update, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

<<<<<<< HEAD
        // Keep role-specific collections consistent with the canonical User record.
        await ensureRoleDocumentsForUser({ user });

        // Realtime: reflect profile changes on other devices/sessions.
        publishBroadcast('users.changed', { userId: String(user._id) });

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
        const wallet = await ensureWallet(String(user._id));
        res.json({ user: toUiUser(user, wallet) });
      } catch (err) {
        next(err);
      }
    },
  };
}
<<<<<<< HEAD

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
