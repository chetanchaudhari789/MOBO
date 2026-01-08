# Migration & seed strategy (MongoDB + Mongoose)

This repo uses MongoDB (Atlas in prod) with Mongoose models.

Key constraints:

- In production, `autoIndex` is disabled (see `backend/database/mongo.ts`), so schema index changes will **not** apply automatically.
- Some collections use soft delete (`deletedAt`). Any uniqueness constraints must respect soft delete (partial unique indexes).

## 1) Migrations (recommended approach)

### Goals

- Apply schema/index changes safely in production.
- Track what ran (idempotent re-runs).
- Fail fast with actionable errors (e.g., duplicates that block unique index creation).

### Implementation

- Migration runner: `backend/scripts/migrate.ts`
- Migration registry: `backend/scripts/migrations/index.ts`
- Migration state collection: `schema_migrations`

Migrations are:

- **Ordered** (by the array order)
- **Idempotent** (records each `id` once)
- **Safe by default** (no data deletes; only creates/replaces indexes in the current migration)

### Commands

From repo root:

- Status: `npm -w @mobo/backend run migrate -- --status`
- Run all pending: `npm -w @mobo/backend run migrate`
- Dry-run (prints what would run): `npm -w @mobo/backend run migrate -- --dry-run`
- Run up to a migration id: `npm -w @mobo/backend run migrate -- --to 2026-01-08-indexes-softdelete-unique`

### Current migrations

- `2026-01-08-indexes-softdelete-unique`
  - Ensures partial unique indexes for:
    - `users.mobile` (active docs only)
    - `users.email` (active docs only, when present)
    - `users.mediatorCode` (active docs only, when present)
    - `wallets.ownerUserId` (active docs only)
    - `transactions.idempotencyKey` (active docs only)
    - `payouts(provider, providerRef)` (active docs only, when present)
  - Preflights for duplicates and fails with a sample list to remediate.

## 2) Seeding (recommended approach)

There are two seed modes:

### A) E2E seed (safe + idempotent)

- Used by the E2E backend entrypoint (`backend/index.e2e.ts`) for Playwright.
- Upserts users by `mobile` so repeated runs are stable.

Run manually:

- `npm -w @mobo/backend run seed:e2e`

Notes:

- This seed is intended for local/dev automation.
- It does not wipe the database.

### B) Large/dev seed (wipe required)

- Script: `backend/seeds/seed.ts`
- Requires explicit opt-in wipe protection.

Run:

- `SEED_WIPE=true npm -w @mobo/backend run seed`

Tuning (env vars):

- `SEED` (default `mobo-seed`)
- `SEED_USERS_PER_ROLE`, `SEED_CAMPAIGNS`, `SEED_DEALS_PER_MEDIATOR`, `SEED_ORDERS`, `SEED_TICKETS`, `SEED_PAYOUTS`

## 3) Deployment order (prod)

Recommended order for a deploy:

1. Deploy code (or at least the new models)
2. Run migrations: `npm -w @mobo/backend run migrate`
3. Start the backend

If a migration fails due to duplicates blocking a unique index:

- Fix duplicates (typically by soft-deleting extra docs or merging data)
- Re-run migrations (idempotent)

## 4) Optional future hardening

If you want to go further later:

- Add per-migration `down()` support only for non-prod environments.
- Add a `--json` status output for CI.
- Add data-cleanup migrations (opt-in) that can remediate duplicates.
