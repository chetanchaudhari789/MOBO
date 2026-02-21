import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { prisma } from '../database/prisma.js';
import { AppError } from '../middleware/errors.js';
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
import { generateHumanCode } from '../services/codes.js';
import { writeAuditLog } from '../services/audit.js';
import { consumeInvite } from '../services/invites.js';
import { ensureWallet } from '../services/walletService.js';
import { toUiUser } from '../utils/uiMappers.js';
import { pgUser, pgWallet } from '../utils/pgMappers.js';
import { ensureRoleDocumentsForUser } from '../services/roleDocuments.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { getAgencyCodeForMediatorCode } from '../services/lineage.js';

export function makeAuthController(env: Env) {
  const db = () => prisma();

  return {
    me: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = String(req.auth?.userId || '').trim();
        if (!userId) {
          throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
        }

        const user = await db().user.findFirst({ where: { mongoId: userId, deletedAt: null } });
        if (!user) {
          throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        }

        const wallet = await ensureWallet(user.id);
        res.json({ user: toUiUser(pgUser(user), pgWallet(wallet)) });
      } catch (err) {
        next(err);
      }
    },

    register: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerSchema.parse(req.body);

        const existing = await db().user.findFirst({ where: { mobile: body.mobile, deletedAt: null } });
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        // Atomic: validate + create user + (optional) consume invite.
        const { user, consumed } = await db().$transaction(async (tx) => {
          // Preferred: invite-based registration.
          const invite = await tx.invite.findFirst({ where: { code: body.mediatorCode, status: 'active' } });

          let upstreamMediatorCode = '';
          let consume: null | { code: string; role: string } = null;

          if (invite) {
            if (String(invite.role) !== 'shopper') {
              throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
            }
            const maxUses = Number(invite.maxUses ?? 1);
            const useCount = Number(invite.useCount ?? 0);
            if (useCount >= maxUses) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            upstreamMediatorCode = String(invite.parentCode || '').trim();
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
          const mediator = await tx.user.findFirst({
            where: {
              mediatorCode: upstreamMediatorCode,
              roles: { has: 'mediator' as any },
              status: 'active',
              deletedAt: null,
            },
          });
          if (!mediator) {
            throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent mediator is not valid');
          }

          const mongoId = new Types.ObjectId().toString();
          const newUser = await tx.user.create({
            data: {
              mongoId,
              name: body.name,
              mobile: body.mobile,
              email: body.email,
              passwordHash,
              role: 'shopper',
              roles: ['shopper'] as any,
              status: 'active',
              parentCode: upstreamMediatorCode,
              isVerifiedByMediator: false,
            },
          });

          await ensureRoleDocumentsForUser({ user: newUser, tx });

          const consumedInvite = consume
            ? await consumeInvite({
                code: consume.code,
                role: consume.role,
                usedByUserId: newUser.id,
                tx,
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
            metadata: { code: consumed.code, role: consumed.role, usedBy: user.mongoId },
          });

          publishRealtime({
            type: 'invites.changed',
            ts: new Date().toISOString(),
            audience: { roles: ['admin', 'ops'] },
          });
        }

        const accessToken = signAccessToken(env, user.mongoId!, user.roles as any);
        const refreshToken = signRefreshToken(env, user.mongoId!, user.roles as any);

        const wallet = await ensureWallet(user.id);

        await writeAuditLog({
          req,
          action: 'USER_REGISTERED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: { role: 'shopper', mobile: user.mobile, parentCode: String(user.parentCode || '') },
        }).catch(() => {});

        const upstreamMediatorCode = String(user.parentCode || '').trim();
        if (upstreamMediatorCode) {
          const agencyCode = (await getAgencyCodeForMediatorCode(upstreamMediatorCode)) || '';
          const ts = new Date().toISOString();
          publishRealtime({
            type: 'users.changed',
            ts,
            payload: { userId: user.mongoId, kind: 'buyer', mediatorCode: upstreamMediatorCode },
            audience: {
              mediatorCodes: [upstreamMediatorCode],
              ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
              roles: ['admin', 'ops'],
            },
          });
          publishRealtime({
            type: 'notifications.changed',
            ts,
            payload: { source: 'buyer.registered', userId: user.mongoId },
            audience: {
              mediatorCodes: [upstreamMediatorCode],
              ...(agencyCode ? { agencyCodes: [agencyCode] } : {}),
              roles: ['admin', 'ops'],
            },
          });
        }
        res.status(201).json({
          user: toUiUser(pgUser(user), pgWallet(wallet)),
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
          ? await db().user.findFirst({ where: { mobile, deletedAt: null } })
          : await db().user.findFirst({ where: { username, roles: { hasSome: ['admin', 'ops'] as any }, deletedAt: null } });
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
          const primaryRole = String(user.role || '').toLowerCase();
          const roles = Array.isArray(user.roles) ? user.roles.map((r: any) => String(r).toLowerCase()) : [];
          const isAdminOrOps = primaryRole === 'admin' || primaryRole === 'ops' || roles.includes('admin') || roles.includes('ops');
          if (isAdminOrOps) {
            await writeAuditLog({
              req,
              action: 'AUTH_LOGIN_FAILED',
              actorUserId: user.mongoId!,
              metadata: { reason: 'username_required' },
            });
            throw new AppError(400, 'USERNAME_REQUIRED', 'Admin login requires username and password');
          }
        }
        if (user.status !== 'active') {
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            actorUserId: user.mongoId!,
            metadata: { reason: 'user_not_active', status: user.status },
          });
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

        // --- Account lockout enforcement ---
        const MAX_FAILED_ATTEMPTS = 7;
        const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
        const lockoutUntil = user.lockoutUntil ? new Date(user.lockoutUntil) : null;
        if (lockoutUntil && lockoutUntil.getTime() > Date.now()) {
          const minutesLeft = Math.ceil((lockoutUntil.getTime() - Date.now()) / 60_000);
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            actorUserId: user.mongoId!,
            metadata: { reason: 'account_locked', lockoutUntil: lockoutUntil.toISOString() },
          });
          throw new AppError(429, 'ACCOUNT_LOCKED', `Account locked. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`);
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
          const newAttempts = (user.failedLoginAttempts ?? 0) + 1;
          await db().user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: { increment: 1 },
              ...(newAttempts >= MAX_FAILED_ATTEMPTS
                ? { lockoutUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }
                : {}),
            },
          });
          await writeAuditLog({
            req,
            action: 'AUTH_LOGIN_FAILED',
            actorUserId: user.mongoId!,
            metadata: { reason: 'invalid_password' },
          });
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }

        // Reset failed attempts on successful login
        if ((user.failedLoginAttempts ?? 0) > 0 || user.lockoutUntil) {
          await db().user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockoutUntil: null },
          });
        }

        const accessToken = signAccessToken(env, user.mongoId!, user.roles as any);
        const refreshToken = signRefreshToken(env, user.mongoId!, user.roles as any);

        const wallet = await ensureWallet(user.id);

        await writeAuditLog({
          req,
          action: 'AUTH_LOGIN_SUCCESS',
          actorUserId: user.mongoId!,
          actorRoles: user.roles as any,
          metadata: { role: user.role },
        });

        res.json({
          user: toUiUser(pgUser(user), pgWallet(wallet)),
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

        const user = await db().user.findFirst({ where: { mongoId: userId, deletedAt: null } });
        if (!user) {
          throw new AppError(401, 'UNAUTHENTICATED', 'User not found');
        }
        if (user.status !== 'active') {
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

        const accessToken = signAccessToken(env, user.mongoId!, user.roles as any);
        const newRefreshToken = signRefreshToken(env, user.mongoId!, user.roles as any);
        const wallet = await ensureWallet(user.id);

        res.json({
          user: toUiUser(pgUser(user), pgWallet(wallet)),
          tokens: { accessToken, refreshToken: newRefreshToken },
        });
      } catch (err) {
        next(err);
      }
    },

    registerOps: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerOpsSchema.parse(req.body);

        const existing = await db().user.findFirst({ where: { mobile: body.mobile, deletedAt: null } });
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        const { user, consumed, pendingApproval } = await db().$transaction(async (tx) => {
          const isMediatorJoin = body.role === 'mediator';

          // Preferred: invite-based.
          const invite = await tx.invite.findFirst({ where: { code: body.code, status: 'active' } });

          let parentCode: string | undefined;
          let createdBy: any | undefined;
          let consume: null | { code: string; role: string } = null;
          let pendingApproval = false;

          if (invite) {
            if (String(invite.role) !== String(body.role)) {
              throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
            }
            const maxUses = Number(invite.maxUses ?? 1);
            const useCount = Number(invite.useCount ?? 0);
            if (useCount >= maxUses) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            parentCode = invite.parentCode ?? undefined;
            createdBy = invite.createdBy;
            consume = { code: body.code, role: body.role };
          } else {
            // Fallback: allow a mediator to join an agency using the agency's code.
            if (!isMediatorJoin) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            pendingApproval = true;

            const agencyCode = String(body.code || '').trim();
            if (!agencyCode) {
              throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
            }

            const agency = await tx.user.findFirst({
              where: {
                mediatorCode: agencyCode,
                roles: { has: 'agency' as any },
                status: 'active',
                deletedAt: null,
              },
            });
            if (!agency) {
              throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent agency is not valid');
            }

            const agencyParentCode = String(agency.mediatorCode || '').trim();
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

            const agency = await tx.user.findFirst({
              where: {
                mediatorCode: agencyCode,
                roles: { has: 'agency' as any },
                status: 'active',
                deletedAt: null,
              },
            });
            if (!agency) {
              throw new AppError(400, 'INVALID_INVITE_PARENT', 'Invite parent agency is not valid');
            }
          }

          const roles = body.role === 'agency' ? ['agency'] : ['mediator'];
          const mediatorCodePrefix = body.role === 'agency' ? 'AGY' : 'MED';
          let mediatorCode = generateHumanCode(mediatorCodePrefix);
          for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const codeExists = await tx.user.findFirst({ where: { mediatorCode }, select: { id: true } });
            if (!codeExists) break;
            mediatorCode = generateHumanCode(mediatorCodePrefix);
          }

          const mongoId = new Types.ObjectId().toString();
          const newUser = await tx.user.create({
            data: {
              mongoId,
              name: body.name,
              mobile: body.mobile,
              passwordHash,
              role: body.role,
              roles: [...roles] as any,
              status: pendingApproval ? 'pending' : 'active',
              mediatorCode,
              parentCode: parentCode,
              kycStatus: 'pending',
              createdBy,
            },
          });

          await ensureRoleDocumentsForUser({ user: newUser, tx });

          const consumedInvite = consume
            ? await consumeInvite({
                code: consume.code,
                role: consume.role,
                usedByUserId: newUser.id,
                tx,
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
            metadata: { code: consumed.code, role: consumed.role, usedBy: user.mongoId },
          });

          publishRealtime({
            type: 'invites.changed',
            ts: new Date().toISOString(),
            audience: { roles: ['admin', 'ops'] },
          });
        }

        writeAuditLog({
          req,
          action: 'USER_REGISTERED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: { role: user.role, mobile: user.mobile, pendingApproval },
        }).catch(() => {});

        // If mediator joined via agency code, the account is pending and must be approved by agency.
        if (pendingApproval) {
          const agencyCode = String(user.parentCode || '').trim();
          if (agencyCode) {
            const ts = new Date().toISOString();
            publishRealtime({
              type: 'users.changed',
              ts,
              payload: { userId: user.mongoId, kind: 'mediator', status: 'pending', agencyCode },
              audience: { agencyCodes: [agencyCode], roles: ['admin', 'ops'] },
            });
            publishRealtime({
              type: 'notifications.changed',
              ts,
              payload: { source: 'mediator.join.requested', userId: user.mongoId, agencyCode },
              audience: { agencyCodes: [agencyCode], roles: ['admin', 'ops'] },
            });
          }
          res.status(202).json({
            pendingApproval: true,
            message: 'Request sent to agency for approval',
          });
          return;
        }

        const accessToken = signAccessToken(env, user.mongoId!, user.roles as any);
        const refreshToken = signRefreshToken(env, user.mongoId!, user.roles as any);

        const wallet = await ensureWallet(user.id);
        res.status(201).json({ user: toUiUser(pgUser(user), pgWallet(wallet)), tokens: { accessToken, refreshToken } });
      } catch (err) {
        next(err);
      }
    },

    registerBrand: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerBrandSchema.parse(req.body);

        const existing = await db().user.findFirst({ where: { mobile: body.mobile, deletedAt: null } });
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        const { user, consumed } = await db().$transaction(async (tx) => {
          // Brand registration MUST be invite-based.
          const invite = await tx.invite.findFirst({ where: { code: body.brandCode, status: 'active' } });
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          if (String(invite.role) !== 'brand') {
            throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
          }
          const maxUses = Number(invite.maxUses ?? 1);
          const useCount = Number(invite.useCount ?? 0);
          if (useCount >= maxUses) {
            throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          }

          // Generate a stable brand code for downstream linking (Brand -> Agency connections).
          let brandCode = generateHumanCode('BRD');
          for (let i = 0; i < 5; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            const exists = await tx.user.findFirst({ where: { brandCode }, select: { id: true } });
            if (!exists) break;
            brandCode = generateHumanCode('BRD');
          }

          const mongoId = new Types.ObjectId().toString();
          const newUser = await tx.user.create({
            data: {
              mongoId,
              name: body.name,
              mobile: body.mobile,
              passwordHash,
              role: 'brand',
              roles: ['brand'] as any,
              status: 'active',
              brandCode,
              createdBy: invite.createdBy,
            },
          });

          await ensureRoleDocumentsForUser({ user: newUser, tx });
          const consumedInvite = await consumeInvite({
            code: body.brandCode,
            role: 'brand',
            usedByUserId: newUser.id,
            tx,
          });

          return { user: newUser, consumed: consumedInvite };
        });

        await writeAuditLog({
          req,
          action: 'INVITE_USED',
          entityType: 'Invite',
          entityId: String(consumed._id),
          metadata: { code: consumed.code, role: consumed.role, usedBy: user.mongoId },
        });

        writeAuditLog({
          req,
          action: 'USER_REGISTERED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: { role: 'brand', mobile: user.mobile },
        }).catch(() => {});

        publishRealtime({
          type: 'invites.changed',
          ts: new Date().toISOString(),
          audience: { roles: ['admin', 'ops'] },
        });
        const accessToken = signAccessToken(env, user.mongoId!, user.roles as any);
        const refreshToken = signRefreshToken(env, user.mongoId!, user.roles as any);

        const wallet = await ensureWallet(user.id);

        res.status(201).json({
          user: toUiUser(pgUser(user), pgWallet(wallet)),
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

        const targetMongoId = body.userId ?? requesterId;
        const requester = await db().user.findFirst({ where: { mongoId: requesterId, deletedAt: null } });
        if (!requester) throw new AppError(401, 'UNAUTHENTICATED', 'User not found');

        const isSelf = String(targetMongoId) === String(requesterId);
        const isAdmin = requester.roles?.includes('admin' as any) || requester.roles?.includes('ops' as any);
        if (!isSelf && !isAdmin) {
          throw new AppError(403, 'FORBIDDEN', 'Cannot update other user profile');
        }

        const targetUser = isSelf
          ? requester
          : await db().user.findFirst({ where: { mongoId: targetMongoId, deletedAt: null } });
        if (!targetUser) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

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
            for (const [k, col] of [
              ['accountNumber', 'bankAccountNumber'],
              ['ifsc', 'bankIfsc'],
              ['bankName', 'bankName'],
              ['holderName', 'bankHolderName'],
            ] as const) {
              const v = raw[k];
              if (typeof v === 'undefined') continue;
              if (typeof v === 'string' && v.trim() === '') continue;
              update[col] = v;
            }
          }
        }

        const user = await db().user.update({
          where: { id: targetUser.id },
          data: update,
        });

        // Keep role-specific collections consistent with the canonical User record.
        await ensureRoleDocumentsForUser({ user });

        await writeAuditLog({
          req,
          action: 'PROFILE_UPDATED',
          entityType: 'User',
          entityId: user.mongoId!,
          metadata: {
            updatedFields: Object.keys(update).filter(k => k !== 'avatar' && k !== 'qrCode'),
            updatedBy: isSelf ? 'self' : 'admin',
          },
        });

        publishRealtime({
          type: 'users.changed',
          ts: new Date().toISOString(),
          payload: { userId: user.mongoId },
          audience: { roles: ['admin', 'ops'], userIds: [user.mongoId!] },
        });
        const wallet = await ensureWallet(user.id);
        res.json({ user: toUiUser(pgUser(user), pgWallet(wallet)) });
      } catch (err) {
        next(err);
      }
    },
  };
}
