import { prisma } from '../database/prisma.js';

export async function listMediatorCodesForAgency(agencyCode: string): Promise<string[]> {
  if (!agencyCode) return [];
  const db = prisma();
  const mediators = await db.user.findMany({
    where: { roles: { has: 'mediator' as any }, parentCode: agencyCode, deletedAt: null },
    select: { mediatorCode: true },
  });
  return mediators.map((m) => String(m.mediatorCode || '')).filter(Boolean);
}

export async function getAgencyCodeForMediatorCode(mediatorCode: string): Promise<string | null> {
  if (!mediatorCode) return null;
  const db = prisma();
  const mediator = await db.user.findFirst({
    where: { roles: { has: 'mediator' as any }, mediatorCode, deletedAt: null },
    select: { parentCode: true },
  });
  const agencyCode = mediator ? String(mediator.parentCode || '').trim() : '';
  return agencyCode || null;
}

export async function isAgencyActive(agencyCode: string): Promise<boolean> {
  if (!agencyCode) return false;
  const db = prisma();
  const agency = await db.user.findFirst({
    where: { roles: { has: 'agency' as any }, mediatorCode: agencyCode, deletedAt: null },
    select: { status: true },
  });
  return !!agency && agency.status === 'active';
}

export async function isMediatorActive(mediatorCode: string): Promise<boolean> {
  if (!mediatorCode) return false;
  const db = prisma();
  const mediator = await db.user.findFirst({
    where: { roles: { has: 'mediator' as any }, mediatorCode, deletedAt: null },
    select: { status: true },
  });
  return !!mediator && mediator.status === 'active';
}
