import { UserModel } from '../models/User.js';
import { hashPassword } from '../services/passwords.js';
import { isPrismaAvailable, prisma } from '../database/prisma.js';

export type SeedAdminArgs = {
  mobile?: string;
  username?: string;
  password?: string;
  name?: string;
  forcePassword?: boolean;
  forceUsername?: boolean;
};

export async function seedAdminOnly(args: SeedAdminArgs = {}) {
  const username = String(args.username ?? process.env.ADMIN_SEED_USERNAME ?? 'root')
    .trim()
    .toLowerCase();
  const mobile = String(args.mobile ?? process.env.ADMIN_SEED_MOBILE ?? '9000000000').trim();
  const password = String(args.password ?? process.env.ADMIN_SEED_PASSWORD ?? 'ChangeMe_123!');
  const name = String(args.name ?? process.env.ADMIN_SEED_NAME ?? 'Root Admin').trim();

  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const looksPlaceholder = (value: string | undefined) => {
    if (!value) return true;
    const v = value.trim();
    if (!v) return true;
    if (v.includes('REPLACE_ME')) return true;
    if (v.toLowerCase().includes('changeme')) return true;
    if (v.startsWith('<') && v.endsWith('>')) return true;
    return false;
  };

  if (!username) throw new Error('seedAdminOnly: username is required');
  if (!mobile) throw new Error('seedAdminOnly: mobile is required');
  if (!password) throw new Error('seedAdminOnly: password is required');
  if (!name) throw new Error('seedAdminOnly: name is required');

  // Production safety: never silently seed a weak/default admin password.
  // You can still run seeding in production, but env vars must be set intentionally.
  if (isProd) {
    if (looksPlaceholder(process.env.ADMIN_SEED_USERNAME) && !args.username) {
      throw new Error('seedAdminOnly: ADMIN_SEED_USERNAME must be set in production');
    }
    if (looksPlaceholder(process.env.ADMIN_SEED_PASSWORD) && !args.password) {
      throw new Error('seedAdminOnly: ADMIN_SEED_PASSWORD must be set in production');
    }
  }

  const shouldForcePassword = args.forcePassword === true;
  const shouldForceUsername = args.forceUsername === true;

  // Prefer to find by username first (admin login is username/password).
  let user = await UserModel.findOne({ username, deletedAt: null });
  if (!user) {
    user = await UserModel.findOne({ mobile, deletedAt: null });
  }

  // Avoid clobbering an existing different user with the same username.
  if (user && user.username && user.username !== username) {
    const existingByUsername = await UserModel.findOne({ username, deletedAt: null }).lean();
    if (existingByUsername && String(existingByUsername._id) !== String(user._id)) {
      throw new Error(`seedAdminOnly: username '${username}' is already taken`);
    }
  }

  if (!user) {
    const passwordHash = await hashPassword(password);
    user = new UserModel({
      name,
      username,
      mobile,
      passwordHash,
      role: 'admin',
      roles: ['admin'],
      status: 'active',
      deletedAt: null,
    });
  } else {
    user.name = name;
    if (!user.username || shouldForceUsername) user.username = username;
    user.mobile = mobile;
    if (shouldForcePassword) {
      user.passwordHash = await hashPassword(password);
    }
    (user as any).role = 'admin';
    (user as any).roles = Array.from(new Set(['admin', ...((user as any).roles ?? [])]));
    (user as any).status = 'active';
    (user as any).deletedAt = null;
  }

  await user.save();

  // Also upsert the admin user in PostgreSQL so PG-primary controllers can find them.
  if (isPrismaAvailable()) {
    const db = prisma();
    // Remove any stale PG user with conflicting mobile (from a previous seed/test run).
    // Delete dependent wallets first to avoid FK constraint violations.
    const staleUsers = await db.user.findMany({ where: { mobile: user.mobile, mongoId: { not: String(user._id) } }, select: { id: true } });
    if (staleUsers.length) {
      const staleIds = staleUsers.map(u => u.id);
      await db.wallet.deleteMany({ where: { ownerUserId: { in: staleIds } } });
      await db.user.deleteMany({ where: { id: { in: staleIds } } });
    }
    await db.user.upsert({
      where: { mongoId: String(user._id) },
      update: {
        name: user.name,
        username: user.username ?? undefined,
        mobile: user.mobile,
        passwordHash: user.passwordHash,
        role: 'admin' as any,
        roles: Array.from(new Set(['admin', ...((user as any).roles ?? [])])) as any,
        status: 'active' as any,
      },
      create: {
        mongoId: String(user._id),
        name: user.name,
        username: user.username ?? undefined,
        mobile: user.mobile,
        passwordHash: user.passwordHash,
        role: 'admin' as any,
        roles: Array.from(new Set(['admin', ...((user as any).roles ?? [])])) as any,
        status: 'active' as any,
      },
    });
  }

  return user;
}
