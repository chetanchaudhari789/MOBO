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

        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        // Atomic: validate + create user + consume invite.
        const { user, consumed } = await withTransaction(async (session) => {
          const invite = await InviteModel.findOne({ code: body.mediatorCode }).session(session).lean();
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');

          const upstreamMediatorCode = String((invite as any).parentCode || '').trim();
          if (!upstreamMediatorCode) {
            throw new AppError(400, 'INVALID_INVITE', 'Invite missing parent mediator code');
          }

          // Parent mediator must be active; upstream agency enforcement happens inside consumeInvite.
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

          const consumedInvite = await consumeInvite({
            code: body.mediatorCode,
            role: 'shopper',
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

    login: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = loginSchema.parse(req.body);

        const user = await UserModel.findOne({ mobile: body.mobile });
        if (!user) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        }
        if (user.status !== 'active') {
          throw new AppError(403, 'USER_NOT_ACTIVE', 'User is not active');
        }

        const ok = await verifyPassword(body.password, user.passwordHash);
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

        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

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
                status: 'active',
                mediatorCode,
                parentCode: parentCode,
                kycStatus: 'pending',
              },
            ],
            { session }
          );

          const newUser = created[0];

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

        const accessToken = signAccessToken(env, String(user._id), user.roles as any);
        const refreshToken = signRefreshToken(env, String(user._id), user.roles as any);

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
      } catch (err) {
        next(err);
      }
    },

    registerBrand: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = registerBrandSchema.parse(req.body);

        const existing = await UserModel.findOne({ mobile: body.mobile }).lean();
        if (existing) {
          throw new AppError(409, 'MOBILE_ALREADY_EXISTS', 'Mobile already registered');
        }

        const passwordHash = await hashPassword(body.password);

        const { user, consumed } = await withTransaction(async (session) => {
          // Brand registration MUST be invite-based.
          // The UI field is currently named `brandCode` but must contain an invite code.
          const invite = await InviteModel.findOne({ code: body.brandCode }).session(session).lean();
          if (!invite) throw new AppError(400, 'INVALID_INVITE', 'Invalid or inactive invite code');
          if (String((invite as any).role) !== 'brand') {
            throw new AppError(400, 'INVITE_ROLE_MISMATCH', 'Invite role mismatch');
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
        for (const key of ['name', 'email', 'avatar', 'upiId', 'qrCode', 'bankDetails'] as const) {
          if (typeof (body as any)[key] !== 'undefined') update[key] = (body as any)[key];
        }

        const user = await UserModel.findByIdAndUpdate(targetUserId, update, { new: true });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        const wallet = await ensureWallet(String(user._id));
        res.json({ user: toUiUser(user, wallet) });
      } catch (err) {
        next(err);
      }
    },
  };
}
