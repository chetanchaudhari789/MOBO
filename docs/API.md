# API surface (UI contract)

All endpoints are rooted at `/api`.

<<<<<<< HEAD
## Conventions

- **Auth**: send `Authorization: Bearer <accessToken>`.
- **Content type**: JSON requests should use `Content-Type: application/json`.
- **Money**: all wallet balances and ledger amounts are stored in **paise** (integer).
- **Roles**:
  - Backend uses `shopper` for buyers; UI may display this as `user`.
  - Most authorization checks are a combination of **role gates** + **ownership scoping**.

## Portal integration (Next.js)

All portals proxy `/api/:path*` to the backend using `next.config.js` rewrites.

- Recommended local setup:

  - Create `apps/<portal>/.env.local` with:

    `NEXT_PUBLIC_API_PROXY_TARGET=http://localhost:8080`

- Client base URL selection (shared client in `@mobo/shared`):
  - `NEXT_PUBLIC_API_URL` (if set) overrides the default.
  - Otherwise it uses relative `/api` (works with Next rewrites in dev + prod).

## Error format

Most non-2xx responses are JSON:

```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "Human readable message",
    "details": []
  }
}
```

- Typical statuses: `400` (validation), `401` (unauthenticated), `403` (forbidden), `404` (not found), `409` (conflict), `429` (rate limit), `500` (server).
- The shared UI client attaches `error.code` onto the thrown `Error` as `err.code`.

=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
## Health

- `GET /api/health` → 200 only if Mongo is connected, else 503.

<<<<<<< HEAD
## Realtime (`/api/realtime`)

- `GET /api/realtime/stream` (auth)
  - SSE stream used by portals for live refresh
  - Events: `ready`, `ping`, plus domain events like `deals.changed`, `users.changed`, `orders.changed`, `wallets.changed`, `tickets.changed`, `notifications.changed`
  - See `docs/REALTIME.md` for the contract

## Auth (`/api/auth`)

### Response shapes

- `AuthResponse`:

```json
{
  "user": { "id": "...", "role": "shopper|mediator|agency|brand|ops|admin", "name": "..." },
  "tokens": { "accessToken": "...", "refreshToken": "..." }
}
```

- `POST /api/auth/register` (buyer) – invite-based via `mediatorCode` (invite code)
  - Body: `{ name, mobile, password, mediatorCode, email? }`
  - 201: `AuthResponse`
- `POST /api/auth/login`
  - Body: `{ mobile, password }`
  - 200: `AuthResponse`
- `GET /api/auth/me` (auth)
  - 200: `{ user }`
- `POST /api/auth/register-ops` (agency/mediator) – invite-based
  - Body: `{ name, mobile, password, role: 'agency'|'mediator', code }`
  - 201: `AuthResponse`
- `POST /api/auth/register-brand` (brand) – invite-based
  - Body: `{ name, mobile, password, brandCode }`
  - 201: `AuthResponse`
- `PATCH /api/auth/profile` (auth)
  - Body: `{ userId, ...updates }` (server applies RBAC/ownership)
  - 200: `{ user }`
=======
## Auth (`/api/auth`)

- `POST /api/auth/register` (buyer) – invite-based via `mediatorCode` (invite code)
- `POST /api/auth/login`
- `GET /api/auth/me` (auth)
- `POST /api/auth/register-ops` (agency/mediator) – invite-based
- `POST /api/auth/register-brand` (brand) – invite-based
- `PATCH /api/auth/profile` (auth)
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

## Admin (`/api/admin`) — role: `admin`

- `GET /api/admin/invites`
- `POST /api/admin/invites`
<<<<<<< HEAD
  - Body: `{ role, label }`
  - 201: `{ code, role, label, ... }`
- `POST /api/admin/invites/revoke`
- `GET /api/admin/users` (query `role=all|user|mediator|agency|brand|admin`)
- `PATCH /api/admin/users/status`
  - Body: `{ userId, status: 'active'|'suspended' }`
=======
- `POST /api/admin/invites/revoke`
- `GET /api/admin/users` (query `role=all|user|mediator|agency|brand|admin`)
- `PATCH /api/admin/users/status`
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
- `GET /api/admin/financials`
- `GET /api/admin/stats`
- `GET /api/admin/growth`
- `GET /api/admin/products`
- `POST /api/admin/orders/reactivate`

## Ops (`/api/ops`) — roles: `agency|mediator|ops|admin`

- Invites:

  - `POST /api/ops/invites/generate` (mediator invites; agency self or privileged)
<<<<<<< HEAD
    - Body: `{ agencyId }`
    - 201: `{ code }`
  - `POST /api/ops/invites/generate-buyer` (buyer invites; mediator self or privileged)
    - Body: `{ mediatorId }`
    - 201: `{ code }`
=======
  - `POST /api/ops/invites/generate-buyer` (buyer invites; mediator self or privileged)
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

- Brand connection:

  - `POST /api/ops/brands/connect` (agency-only) – requests a connection to a brand by `brandCode`
<<<<<<< HEAD
    - Body: `{ brandCode }`
    - 200: `{ ok: true, ... }` (shape may include connection/request metadata)
    - Errors: `ALREADY_REQUESTED` is treated as idempotent by the agency portal.
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

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
<<<<<<< HEAD
    - Roles: `admin|ops`
    - Body: `{ orderId, settlementRef? }`
    - 200: `{ ok: true, ... }`
    - Money invariants: settlement creates an idempotent **brand debit** and then credits buyer+mediator.
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

- Campaign + deals:

  - `POST /api/ops/campaigns` (creates campaigns)
<<<<<<< HEAD
    - Body: campaign details; scoping enforced (non-privileged can only create for self/network)
  - `POST /api/ops/campaigns/assign` (assign slots; locks campaign terms)
    - Body: `{ id, assignments, dealType?, price?, payout? }`
  - `POST /api/ops/deals/publish`
    - Body: `{ id, commission, mediatorCode }`
=======
  - `POST /api/ops/campaigns/assign` (assign slots; locks campaign terms)
  - `POST /api/ops/deals/publish`
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

- Payouts:
  - `POST /api/ops/payouts` (payout mediator)

## Brand (`/api/brand`) — roles: `brand|admin|ops`

- `GET /api/brand/agencies`
- `GET /api/brand/campaigns`
- `GET /api/brand/orders`
- `GET /api/brand/transactions`
- `POST /api/brand/payout` (brand→agency wallet transfer)
<<<<<<< HEAD
  - Body: `{ brandId, agencyId, amount, ref }`
  - 200: payout/transfer confirmation payload
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
- `POST /api/brand/requests/resolve` (approve/reject pending agency connection)
  - Accepts either `agencyId` (UI) or `agencyCode` (legacy/internal) + `action`
- `POST /api/brand/agencies/remove`
- `POST /api/brand/campaigns`
- `PATCH /api/brand/campaigns/:campaignId` (campaign terms locked after first order or slot assignment)

## Products

- `GET /api/products` (role: buyer/shopper)
<<<<<<< HEAD
  - 200: `Product[]`
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
- `POST /api/deals/:dealId/redirect` (role: buyer/shopper) – creates a REDIRECTED pre-order and returns `{ preOrderId, url }`

## Orders

- `GET /api/orders/user/:userId` (auth; self or privileged)
<<<<<<< HEAD
  - 200: `Order[]`
- `POST /api/orders` (buyer creates/updates order)
  - Body: `{ userId, items, ...metadata }`
  - 200/201: `Order`
- `POST /api/orders/claim` (submit proof)
  - Body: `{ orderId, type, data }`
  - 200: updated `Order`
=======
- `POST /api/orders` (buyer creates/updates order)
- `POST /api/orders/claim` (submit proof)
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

## Tickets

- `GET /api/tickets` (auth; scoped by role/network)
<<<<<<< HEAD
  - 200: `Ticket[]`
- `POST /api/tickets`
  - Body: `{ title, message, ... }`
- `PATCH /api/tickets/:id`
  - Body: `{ status }`
=======
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

## AI (`/api/ai`)

- `POST /api/ai/chat` (optional auth; rate-limited)
<<<<<<< HEAD
  - Body: `{ message, userName?, products?, orders?, tickets?, image? }`
  - 200: chat UI response payload
- `GET /api/ai/status`
- `POST /api/ai/check-key` (auth; roles: admin/ops)
- `POST /api/ai/verify-proof` (optional auth; rate-limited)
  - Body: `{ imageBase64, expectedOrderId, expectedAmount }`
  - 200: `{ orderIdMatch, amountMatch, confidenceScore, ... }`
=======
- `GET /api/ai/status`
- `POST /api/ai/check-key` (auth; roles: admin/ops)
- `POST /api/ai/verify-proof` (optional auth; rate-limited)
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176

Notes:

- Requests are limited by global rate limit plus stricter AI limits.
- JSON body size is capped at 10mb.
<<<<<<< HEAD
- For enforceable RBAC expectations, see `docs/RBAC_MATRIX.md` and the backend tests in `backend/tests/rbac.policy.spec.ts`.
=======
>>>>>>> 2409ed58efd6294166fb78b98ede68787df5e176
