import { UserModel } from '../models/User.js';

export async function listMediatorCodesForAgency(agencyCode: string): Promise<string[]> {
  if (!agencyCode) return [];
  const mediators = await UserModel.find({ roles: 'mediator', parentCode: agencyCode, deletedAt: { $exists: false } })
    .select({ mediatorCode: 1 })
    .lean();
  return mediators.map((m) => String((m as any).mediatorCode || '')).filter(Boolean);
}

export async function getAgencyCodeForMediatorCode(mediatorCode: string): Promise<string | null> {
  if (!mediatorCode) return null;
  const mediator = await UserModel.findOne({ roles: 'mediator', mediatorCode, deletedAt: { $exists: false } })
    .select({ parentCode: 1 })
    .lean();
  const agencyCode = mediator ? String((mediator as any).parentCode || '').trim() : '';
  return agencyCode || null;
}

export async function isAgencyActive(agencyCode: string): Promise<boolean> {
  if (!agencyCode) return false;
  const agency = await UserModel.findOne({ roles: 'agency', mediatorCode: agencyCode, deletedAt: { $exists: false } })
    .select({ status: 1 })
    .lean();
  return !!agency && (agency as any).status === 'active';
}

export async function isMediatorActive(mediatorCode: string): Promise<boolean> {
  if (!mediatorCode) return false;
  const mediator = await UserModel.findOne({ roles: 'mediator', mediatorCode, deletedAt: { $exists: false } })
    .select({ status: 1 })
    .lean();
  return !!mediator && (mediator as any).status === 'active';
}
