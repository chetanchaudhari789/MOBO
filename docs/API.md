# API surface (UI contract)

All endpoints are rooted at `/api`.

## Health

- `GET /api/health` → 200 only if Mongo is connected, else 503.

## Auth (`/api/auth`)

- `POST /api/auth/register` (buyer) – invite-based via `mediatorCode` (invite code)
- `POST /api/auth/login`
- `GET /api/auth/me` (auth)
- `POST /api/auth/register-ops` (agency/mediator) – invite-based
- `POST /api/auth/register-brand` (brand) – invite-based
- `PATCH /api/auth/profile` (auth)

## Admin (`/api/admin`) — role: `admin`

- `GET /api/admin/invites`
- `POST /api/admin/invites`
- `POST /api/admin/invites/revoke`
- `GET /api/admin/users` (query `role=all|user|mediator|agency|brand|admin`)
- `PATCH /api/admin/users/status`
- `GET /api/admin/financials`
- `GET /api/admin/stats`
- `GET /api/admin/growth`
- `GET /api/admin/products`
- `POST /api/admin/orders/reactivate`

## Ops (`/api/ops`) — roles: `agency|mediator|ops|admin`

- Invites:

  - `POST /api/ops/invites/generate` (mediator invites; agency self or privileged)
  - `POST /api/ops/invites/generate-buyer` (buyer invites; mediator self or privileged)

- Brand connection:

  - `POST /api/ops/brands/connect` (agency-only) – requests a connection to a brand by `brandCode`

- Network + operations:

  - `GET /api/ops/mediators` (scope depends on role; privileged can query arbitrary)
  - `GET /api/ops/campaigns`
  - `GET /api/ops/orders`
  - `GET /api/ops/users/pending`
  - `GET /api/ops/users/verified`
  - `GET /api/ops/ledger`

- Approvals + workflow:

  - `POST /api/ops/mediators/approve` (privileged)
  - `POST /api/ops/users/approve`
  - `POST /api/ops/users/reject`
  - `POST /api/ops/verify` (verifies order claim; anti-collusion checks)
  - `POST /api/ops/orders/settle`

- Campaign + deals:

  - `POST /api/ops/campaigns` (creates campaigns)
  - `POST /api/ops/campaigns/assign` (assign slots; locks campaign terms)
  - `POST /api/ops/deals/publish`

- Payouts:
  - `POST /api/ops/payouts` (payout mediator)

## Brand (`/api/brand`) — roles: `brand|admin|ops`

- `GET /api/brand/agencies`
- `GET /api/brand/campaigns`
- `GET /api/brand/orders`
- `GET /api/brand/transactions`
- `POST /api/brand/payout` (brand→agency wallet transfer)
- `POST /api/brand/requests/resolve` (approve/reject pending agency connection)
  - Accepts either `agencyId` (UI) or `agencyCode` (legacy/internal) + `action`
- `POST /api/brand/agencies/remove`
- `POST /api/brand/campaigns`
- `PATCH /api/brand/campaigns/:campaignId` (campaign terms locked after first order or slot assignment)

## Products

- `GET /api/products` (role: buyer/shopper)
- `POST /api/deals/:dealId/redirect` (role: buyer/shopper) – creates a REDIRECTED pre-order and returns `{ preOrderId, url }`

## Orders

- `GET /api/orders/user/:userId` (auth; self or privileged)
- `POST /api/orders` (buyer creates/updates order)
- `POST /api/orders/claim` (submit proof)

## Tickets

- `GET /api/tickets` (auth; scoped by role/network)
- `POST /api/tickets`
- `PATCH /api/tickets/:id`

## AI (`/api/ai`)

- `POST /api/ai/chat` (optional auth; rate-limited)
- `GET /api/ai/status`
- `POST /api/ai/check-key` (auth; roles: admin/ops)
- `POST /api/ai/verify-proof` (optional auth; rate-limited)

Notes:

- Requests are limited by global rate limit plus stricter AI limits.
- JSON body size is capped at 10mb.
