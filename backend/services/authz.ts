import type { Request } from 'express';
import { AppError } from '../middleware/errors.js';

export function getRequester(req: Request) {
  const userId = req.auth?.userId;
  const roles = req.auth?.roles ?? [];
  const user = req.auth?.user;
  if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Missing auth context');
  return { userId, roles, user };
}

export function isPrivileged(roles: string[]) {
  return roles.includes('admin') || roles.includes('ops');
}

export function requireAnyRole(roles: string[], ...required: string[]) {
  const ok = required.some((r) => roles.includes(r));
  if (!ok) throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
}

export function requireSelfOrPrivileged(requesterId: string, targetUserId: string, roles: string[]) {
  if (requesterId !== targetUserId && !isPrivileged(roles)) {
    throw new AppError(403, 'FORBIDDEN', 'Not allowed');
  }
}
