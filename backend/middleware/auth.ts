import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import type { Env } from '../config/env.js';
import { AppError } from './errors.js';
import { UserModel, type UserDoc } from '../models/User.js';

export type Role = 'shopper' | 'mediator' | 'agency' | 'brand' | 'admin' | 'ops';

export type AuthUser = Pick<
  UserDoc,
  'status' | 'roles' | 'role' | 'parentCode' | 'mediatorCode' | 'brandCode' | 'deletedAt' | 'mobile' | 'name'
> & {
  _id: Types.ObjectId;
};

export type AuthContext = {
  userId: string;
  roles: Role[];
  user?: AuthUser;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(env: Env) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') || '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

    if (!token) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token'));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
      const userId = String(decoded.sub || '');

      if (!userId) {
        return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid token'));
      }

      // Zero-trust: do not trust roles/status embedded in the JWT.
      // Fetch from DB so suspensions and role changes take effect immediately.
      const user = await UserModel.findById(userId)
        .select({ status: 1, roles: 1, role: 1, parentCode: 1, mediatorCode: 1, brandCode: 1, deletedAt: 1, mobile: 1, name: 1 })
        .lean();

      if (!user || (user as any).deletedAt) {
        return next(new AppError(401, 'UNAUTHENTICATED', 'User not found'));
      }

      if (user.status !== 'active') {
        return next(new AppError(403, 'USER_NOT_ACTIVE', 'User is not active'));
      }

      const roles = Array.isArray(user.roles) ? (user.roles as Role[]) : [];

      // Upstream suspension enforcement (non-negotiable):
      // - Buyer loses access immediately when their mediator or agency is suspended.
      // - Mediator loses access immediately when their agency is suspended.
      const parentCode = String((user as any).parentCode || '').trim();

      if (roles.includes('mediator')) {
        if (parentCode) {
          const agency = await UserModel.findOne({
            mediatorCode: parentCode,
            roles: 'agency',
            deletedAt: { $exists: false },
          })
            .select({ status: 1 })
            .lean();
          if (!agency || agency.status !== 'active') {
            return next(new AppError(403, 'UPSTREAM_SUSPENDED', 'Upstream agency is not active'));
          }
        }
      }

      if (roles.includes('shopper')) {
        if (parentCode) {
          const mediator = await UserModel.findOne({
            mediatorCode: parentCode,
            roles: 'mediator',
            deletedAt: { $exists: false },
          })
            .select({ status: 1, parentCode: 1 })
            .lean();
          if (!mediator || mediator.status !== 'active') {
            return next(new AppError(403, 'UPSTREAM_SUSPENDED', 'Upstream mediator is not active'));
          }

          const agencyCode = String((mediator as any).parentCode || '').trim();
          if (agencyCode) {
            const agency = await UserModel.findOne({
              mediatorCode: agencyCode,
              roles: 'agency',
              deletedAt: { $exists: false },
            })
              .select({ status: 1 })
              .lean();
            if (!agency || agency.status !== 'active') {
              return next(new AppError(403, 'UPSTREAM_SUSPENDED', 'Upstream agency is not active'));
            }
          }
        }
      }

      req.auth = { userId, roles, user: user as any };
      next();
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    }
  };
}

export function requireRoles(...required: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const roles = req.auth?.roles || [];
    const ok = required.some((r) => roles.includes(r));
    if (!ok) {
      return next(new AppError(403, 'FORBIDDEN', 'Insufficient role'));
    }
    next();
  };
}
