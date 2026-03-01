import jwt from 'jsonwebtoken';
import type { Env } from '../config/env.js';
import type { UserRole } from '../generated/prisma/client.js';

export type Role = UserRole;

export function signAccessToken(env: Env, userId: string, roles: Role[]): string {
  return jwt.sign({ roles, typ: 'access' }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function signRefreshToken(env: Env, userId: string, roles: Role[]): string {
  return jwt.sign({ roles, typ: 'refresh' }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
  });
}
