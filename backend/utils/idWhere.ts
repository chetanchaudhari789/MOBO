/**
 * ID-format-aware Prisma where-clause helper.
 *
 * During the MongoDB → PostgreSQL migration, entities may be referenced by
 * either their original MongoDB ObjectId (stored in `mongoId`) or by their
 * native PG UUID primary key (`id`).
 *
 * This utility inspects the incoming string:
 *  - UUID pattern  → `{ id: value }`   (native PG lookup)
 *  - Anything else → `{ mongoId: value }` (legacy Mongo key)
 *
 * Usage:
 *   db().campaign.findFirst({ where: { ...idWhere(someId), deletedAt: null } })
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export function idWhere(value: string): { id: string } | { mongoId: string } {
  return isUUID(value) ? { id: value } : { mongoId: value };
}
