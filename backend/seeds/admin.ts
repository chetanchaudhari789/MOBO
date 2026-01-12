import { UserModel } from '../models/User.js';
import { hashPassword } from '../services/passwords.js';

export type SeedAdminArgs = {
  mobile?: string;
  username?: string;
  password?: string;
  name?: string;
};

export async function seedAdminOnly(args: SeedAdminArgs = {}) {
  const username = String(args.username ?? process.env.ADMIN_SEED_USERNAME ?? 'root')
    .trim()
    .toLowerCase();
  const mobile = String(args.mobile ?? process.env.ADMIN_SEED_MOBILE ?? '9000000000').trim();
  const password = String(args.password ?? process.env.ADMIN_SEED_PASSWORD ?? 'ChangeMe_123!');
  const name = String(args.name ?? process.env.ADMIN_SEED_NAME ?? 'Root Admin').trim();

  if (!username) throw new Error('seedAdminOnly: username is required');
  if (!mobile) throw new Error('seedAdminOnly: mobile is required');
  if (!password) throw new Error('seedAdminOnly: password is required');
  if (!name) throw new Error('seedAdminOnly: name is required');

  const passwordHash = await hashPassword(password);

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
    user.username = username;
    user.mobile = mobile;
    user.passwordHash = passwordHash;
    (user as any).role = 'admin';
    (user as any).roles = Array.from(new Set(['admin', ...((user as any).roles ?? [])]));
    (user as any).status = 'active';
    (user as any).deletedAt = null;
  }

  await user.save();
  return user;
}
