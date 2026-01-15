# Backend API Surface (Inventory)

Base URL: `/api`

This document is an _inventory_ of the current backend endpoints and their access rules/behavior (not a full contract spec). It is intended as groundwork for the RBAC matrix and the formal API contract.

## Auth model (high level)

- Auth: `Authorization: Bearer <accessToken>`
- `requireAuth(env)`:
  - Verifies JWT
  - Reloads user from DB (zero-trust roles/status)
  - Enforces active status + upstream suspension rules (buyer depends on mediator+agency; mediator depends on agency)
- `requireRoles(...roles)`: role gate after auth
- `optionalAuth(env)`: attaches `req.auth` when a valid token is present (AI routes)

Roles observed: `admin`, `ops`, `brand`, `agency`, `mediator`, `shopper`.

## Route groups

### Health

- `GET /api/health`
  - Auth: none
  - Behavior: returns DB `readyState` + `status` (`ok` when connected, else `degraded`).

### Realtime (`/api/realtime/*`)

- `GET /api/realtime/health`

  - Auth: none
  - Behavior: lightweight health check for the realtime subsystem.

- `GET /api/realtime/stream`
  - Auth: `requireAuth`
  - Behavior: Server-sent events (SSE) stream used by the portals for live refresh/invalidation.
  - Notes: sends `ready` on connect and `ping` every ~25s.
  - Contract: see `docs/REALTIME.md`.

### Auth (`/api/auth/*`)

- `POST /api/auth/register`

  - Auth: none
  - Behavior: creates `shopper` user using an invite code in `mediatorCode` (invite must point to an active mediator; upstream agency validity enforced during invite consumption).

- `POST /api/auth/login`

  - Auth: none
  - Behavior: mobile+password login; rejects non-active users.

- `GET /api/auth/me`

  - Auth: `requireAuth`
  - Behavior: returns `{ user }` + ensures wallet exists.

- `POST /api/auth/register-ops`

  - Auth: none
  - Behavior: invite-based registration for `agency` or `mediator` (role must match invite).

- `POST /api/auth/register-brand`

  - Auth: none
  - Behavior: invite-based registration for `brand` (UI field `brandCode` actually carries the invite code). Generates stable `brandCode` for future linking.

- `PATCH /api/auth/profile`
  - Auth: `requireAuth`
  - Behavior: updates profile fields (name/email/avatar/upiId/qrCode/bankDetails). Only self, or `admin|ops` may update another user via `userId`.

### Admin (`/api/admin/*`)

Guard: `requireAuth` + `requireRoles('admin')`

- `GET /api/admin/invites`
- `POST /api/admin/invites`
- `POST /api/admin/invites/revoke`

  - Behavior: create/list/revoke invites (audit logged).

- `GET /api/admin/users`

  - Behavior: list users (optional `role` filter) and joins wallet balances.

- `GET /api/admin/financials`

  - Behavior: returns recent orders (UI financial view).

- `GET /api/admin/stats`

  - Behavior: aggregates user counts + order revenue/pending/risk.

- `GET /api/admin/growth`

  - Behavior: 7-day revenue buckets.

- `GET /api/admin/products`

  - Behavior: lists all deals.

- `PATCH /api/admin/users/status`

  - Behavior: suspends/unsuspends a user; on suspend also freezes impacted workflows and disables partner inventory as appropriate.

- `POST /api/admin/orders/reactivate`
  - Behavior: reactivates a frozen order via workflow helper (audit logged).

### Ops / Partner (`/api/ops/*`)

Guard: `requireAuth` + `requireRoles('agency','mediator','ops','admin')`

Invites

- `POST /api/ops/invites/generate`

  - Behavior: generate mediator invite for an agency (agency self allowed; `admin|ops` can generate for any).

- `POST /api/ops/invites/generate-buyer`
  - Behavior: generate buyer invite for a mediator (mediator self allowed; `admin|ops` can generate for any).

Brand connections

- `POST /api/ops/brands/connect`
  - Role intent: agency
  - Behavior: agency requests connection by `brandCode` (creates a `pendingConnections` entry on the brand).

Network / dashboards

- `GET /api/ops/mediators`

  - Behavior: agency-scoped mediator list (or `admin|ops` can pass `agencyCode`).

- `GET /api/ops/campaigns`

  - Behavior: scoped campaigns based on requester code via `allowedAgencyCodes` or mediator assignment (admin/ops can pass `mediatorCode`).

- `GET /api/ops/orders`

  - Behavior:
    - mediator: orders where `managerName == mediatorCode`
    - agency: orders where `managerName` in agency mediatorCodes
    - admin/ops: requires `mediatorCode` + optional `role=agency` to expand.

- `GET /api/ops/users/pending`
- `GET /api/ops/users/verified`

  - Behavior: buyer list under a mediator code (self or `admin|ops` via query).

- `GET /api/ops/ledger`
  - Behavior: payout ledger; mediator sees own, agency sees all mediators under it, `admin|ops` sees all.

Approvals / verification / settlement

- `POST /api/ops/mediators/approve`

  - Guarded in controller: `admin|ops` only. Sets mediator KYC verified.

- `POST /api/ops/users/approve`

  - Behavior: mediators can only approve their own buyers; `admin|ops` can approve any.

- `POST /api/ops/users/reject`

  - Behavior: mediators can only reject their own buyers; `admin|ops` can reject any.

- `POST /api/ops/verify`

  - Behavior: verifies an order claim and advances strict workflow `UNDER_REVIEW -> APPROVED`.
  - Important: mediator self-verification for their own buyers is blocked (`SELF_VERIFICATION_FORBIDDEN`).

- `POST /api/ops/orders/settle`
  - Guarded in controller: `admin|ops` only.
  - Behavior:
    - Enforces workflow `APPROVED -> REWARD_PENDING -> COMPLETED/FAILED`
    - Applies wallet credits (buyer commission + mediator margin) when not over cap
    - Freezes on disputes / upstream suspensions.

Campaigns / deals / payouts

- `POST /api/ops/campaigns`

  - Behavior:
    - `admin|ops`: creates campaign for a brand (`brandUserId` required; `allowedAgencies` must be connected to brand)
    - `agency|mediator`: creates self-owned inventory campaign; `allowedAgencies` must be exactly their own code.

- `POST /api/ops/campaigns/assign`

  - Behavior:
    - Persists per-mediator assignments (limit + payout override)
    - Locks campaign permanently after first assignment (or if orders already exist).

- `POST /api/ops/deals/publish`

  - Behavior:
    - mediator publishes deal for self (must be in an allowed agency for the campaign)
    - Commission cannot exceed payout
    - Uses assignment payout when present.

- `POST /api/ops/payouts`
  - Guarded in controller: `admin|ops` only
  - Behavior: creates a paid payout + debits mediator wallet (`payout_complete`).

### Brand (`/api/brand/*`)

Guard: `requireAuth` + `requireRoles('brand','admin','ops')`

- `GET /api/brand/agencies`

  - Behavior: brand sees only connected agencies; `admin|ops` can see all agencies.

- `GET /api/brand/campaigns`

  - Behavior: brand sees own campaigns; `admin|ops` can request a specific `brandId`.

- `GET /api/brand/orders`

  - Behavior:
    - brand sees own orders (brandUserId; legacy fallback by brandName)
    - non-privileged brand responses are redacted (no buyer PII / proof artifacts).

- `GET /api/brand/transactions`

  - Behavior: brand payout ledger from `Transaction` records (`type='agency_payout'`).

- `POST /api/brand/payout`

  - Behavior: idempotent payout recording:
    - Debits brand wallet (`agency_payout`)
    - Credits agency wallet (`agency_receipt`)
    - Brand must be connected to the agency (unless `admin|ops`).

- `POST /api/brand/requests/resolve`

  - Behavior: approve/reject a pending agency connection request (updates `pendingConnections` and `connectedAgencies`).

- `POST /api/brand/agencies/remove`

  - Behavior: removes agency from connected list.

- `POST /api/brand/campaigns`

  - Behavior: brand campaign creation requires `allowedAgencies` and (for non-privileged) they must all be connected.

- `PATCH /api/brand/campaigns/:campaignId`
  - Behavior: brand-only mutation; campaign becomes locked after first order or after slot assignment (except status-only updates).

### Shopper products (`/api/products` and `/api/deals/*`)

- `GET /api/products`

  - Auth: `requireAuth` + `requireRoles('shopper')`
  - Behavior: lists active deals for the buyer’s linked mediator.

- `POST /api/deals/:dealId/redirect`
  - Auth: `requireAuth` + `requireRoles('shopper')`
  - Behavior: creates a `REDIRECTED` pre-order and returns `{ preOrderId, url }`.

### Orders (`/api/orders/*`)

- `GET /api/orders/user/:userId`

  - Auth: `requireAuth`
  - Behavior: owner-only unless `admin|ops`.

- `POST /api/orders`

  - Auth: `requireAuth`
  - Behavior (buyer-only):
    - Enforces per-buyer velocity limits
    - Blocks duplicate externalOrderId
    - Blocks duplicate deal orders per buyer
    - Enforces campaign availability to buyer lineage (agency allow-list OR mediator assignment)
    - Supports upgrading a redirect pre-order via `preOrderId`.

- `POST /api/orders/claim`
  - Auth: `requireAuth`
  - Behavior: attaches proof (order/rating/review) and transitions workflow into `UNDER_REVIEW` (unless already there).

### Tickets (`/api/tickets/*`)

- `GET /api/tickets`

  - Auth: `requireAuth`
  - Behavior:
    - `admin|ops`: all tickets
    - shopper: own tickets
    - brand/agency/mediator: tickets for orders within their scope OR their own tickets; brand responses are redacted.

- `POST /api/tickets`

  - Auth: `requireAuth`
  - Behavior: can reference an order only if within requester scope.

- `PATCH /api/tickets/:id`
  - Auth: `requireAuth`
  - Behavior: owner can update; `admin|ops` can update any; otherwise must have order-scope.

### AI (`/api/ai/*`)

Guard: `optionalAuth` (route-level auth where needed)

- `POST /api/ai/chat`

  - Auth: optional
  - Rate-limited (stricter in prod; higher quota when authenticated)
  - Behavior: never trusts client `userId/userName` when authenticated.

- `GET /api/ai/status`

  - Auth: none
  - Behavior: returns `{ configured: boolean }`.

- `POST /api/ai/check-key`

  - Auth: `requireAuth` + `requireRoles('admin','ops')`
  - Behavior: validates configured Gemini API key.

- `POST /api/ai/verify-proof`
  - Auth: optional
  - Rate-limited
  - Behavior: in `SEED_E2E` mode, bypasses external AI and returns deterministic matches.
