import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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
  refreshSchema,
  updateProfileSchema,
} from '../validations/auth.js';
import { InviteModel } from '../models/Invite.js';
import { generateHumanCode } from '../services/codes.js';
import { writeAuditLog } from '../services/audit.js';
import { consumeInvite } from '../services/invites.js';
import { ensureWallet } from '../services/walletService.js';
import { toUiUser } from '../utils/uiMappers.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { getAgencyCodeForMediatorCode } from '../services/lineage.js';

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

        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

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
          await ensureRoleDocumentsForUser({ user: newUser, session });

          const consumedInvite = consume
            ? await consumeInvite({
                code: consume.code,
                role: consume.role,
                usedByUserId: String(newUser._id),
                session,
              })
            : null;

          return { user: newUser, consumed: consumedInvite };
        });

        if (consumed) {
          await writeAuditLog({
            req,
            action: 'INVITE_USED',
            entityType: 'Invite',
            entityId: String(consumed._id),
            metadata: { code: consumed.code, role: consumed.role, usedBy: String(user._id) },
          });

          // Realtime: keep admin invite list accurate (status/useCount/usedAt).
          // Do not broadcast invite codes; scope to privileged roles.
          publishRealtime({
            type: 'invites.changed',
            ts: new Date().toISOString(),
            audience: { roles: ['admin', 'ops'] },
          });
        }

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));

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

        const password = (body as any).password;

        const mobile = typeof (body as any).mobile === 'string' ? String((body as any).mobile).trim() : '';
        const usernameRaw =
          typeof (body as any).username === 'string' ? String((body as any).username).trim() : '';
        const username = usernameRaw ? usernameRaw.toLowerCase() : '';

        const user = mobile
          ? await UserModel.findOne({ mobile, deletedAt: null })
          : await UserModel.findOne({ username, role: { $in: ['admin', 'ops'] }, deletedAt: null });
        if (!user) {
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            metadata: { reason: 'user_not_found', mobile: mobile || undefined, username: username || undefined },
          });
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }

        // Admin/ops must use username login (mobile is not accepted for these roles).
        if (mobile) {
          const primaryRole = String((user as any).role || '').toLowerCase();
          const roles = Array.isArray((user as any).roles) ? (user as any).roles.map((r: any) => String(r).toLowerCase()) : [];
          const isAdminOrOps = primaryRole === 'admin' || primaryRole === 'ops' || roles.includes('admin') || roles.includes('ops');
          if (isAdminOrOps) {
            await writeAuditLog({
              req,
              action: 'AUTH_LOGIN_FAILED',
              actorUserId: String(user._id),
              metadata: { reason: 'username_required' },
            });
            throw new AppError(400, 'USERNAME_REQUIRED', 'Admin login requires username and password');
          }
        }
        if (user.status !== 'active') {
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            actorUserId: String(user._id),
            metadata: { reason: 'user_not_active', status: user.status },
          });
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            actorUserId: String(user._id),
            metadata: { reason: 'invalid_password' },
          });
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));

        await writeAuditLog({
          req,
          action: 'AUTH_LOGIN_SUCCESS',
          actorUserId: String(user._id),
          actorRoles: user.roles as any,
          metadata: { role: user.role },
        });

        res.json({
          user: toUiUser(user, wallet),
          tokens: { accessToken, refreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    refresh: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = refreshSchema.parse(req.body);
        const refreshToken = String(body.refreshToken || '').trim();
        if (!refreshToken) throw new AppError(401, 'UNAUTHENTICATED', 'Missing refresh token');

        let decoded: jwt.JwtPayload;
        try {
          decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
        } catch {
          throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired refresh token');
        }

        if (decoded?.typ !== 'refresh') {
          throw new AppError(401, 'UNAUTHENTICATED', 'Invalid refresh token');
        }

        const userId = String(decoded.sub || '').trim();
        if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Invalid refresh token');

        const user = await UserModel.findById(userId).lean();
        if (!user || (user as any).deletedAt) {
          throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        }
        if (user.status !== 'active') {
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const newRefreshToken = signRefreshToken(env, String(user._id), user.roles as any);
        const wallet = await ensureWallet(String(user._id));

        res.json({
          user: toUiUser(user, wallet),
          tokens: { accessToken, refreshToken: newRefreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    registerOps: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerOpsSchema.parse(req.body);

        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

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
                status: pendingApproval ? 'pending' : 'active',
                mediatorCode,
                parentCode: parentCode,
                kycStatus: 'pending',
                createdBy,
              },
            ],
            { session }
          );

          const newUser = created[0];

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

          publishRealtime({
            type: 'invites.changed',
            ts: new Date().toISOString(),
            audience: { roles: ['admin', 'ops'] },
          });
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

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

        const wallet = await ensureWallet(String(user._id));
        res.status(201).json({ user: toUiUser(user, wallet), tokens: { accessToken, refreshToken } });
      } catch (err) {
        next(err);
      }
    },

    registerBrand: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerBrandSchema.parse(req.body);

        const existing = await UserModel.findOne({ mobile: body.mobile, deletedAt: null }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        const { user, consumed } = await withTransaction(async (session) => {
          // Brand registration MUST be invite-based.
          // The UI field is currently named `brandCode` but must contain an invite code.
          const invite = await InviteModel.findOne({ code: body.brandCode, status: 'active' })
            .session(session)
            .lean();
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          if (String((invite as any).role) !== 'brand') {
            throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
          }
          const maxUses = Number((invite as any).maxUses ?? 1);
          const useCount = Number((invite as any).useCount ?? 0);
          if (useCount >= maxUses) {
            throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          }

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

          await ensureRoleDocumentsForUser({ user: newUser, session });
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

        publishRealtime({
          type: 'invites.changed',
          ts: new Date().toISOString(),
          audience: { roles: ['admin', 'ops'] },
        });
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
        }

        const user = await UserModel.findByIdAndUpdate(targetUserId, update, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        // Keep role-specific collections consistent with the canonical User record.
        await ensureRoleDocumentsForUser({ user });

        // Realtime: reflect profile changes on other devices/sessions.
        publishRealtime({
          type: 'users.changed',
          ts: new Date().toISOString(),
          payload: { userId: String(user._id) },
          audience: { roles: ['admin', 'ops'], userIds: [String(user._id)] },
        });
        const wallet = await ensureWallet(String(user._id));
        res.json({ user: toUiUser(user, wallet) });
      } catch (err) {
        next(err);
      }
    },
  };
}
