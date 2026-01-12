# RBAC Matrix (As Implemented)

This is the _current_ authorization view derived from route guards + controller ownership checks. It is meant to be used as a working document for tightening/standardizing RBAC.

Base URL: `/api`

## Roles

- `admin`: global privileged
- `ops`: global privileged (treated as admin-equivalent by `isPrivileged`)
- `brand`: brand portal user
- `agency`: agency portal user
- `mediator`: mediator portal user
- `shopper`: buyer user

Notes:

- Most routes rely on `requireAuth(env)` (JWT + DB reload) and `requireRoles(...)` for coarse gating.
- Fine-grained scoping is often in controllers (e.g., “only your network”).

## Matrix (high level)

Legend:

- ✅ = allowed
- ❌ = not allowed
- ⚠️ = allowed but scoped (ownership/network)

| Area / Route Group                          | shopper | mediator | agency | brand |  ops | admin |
| ------------------------------------------- | ------: | -------: | -----: | ----: | ---: | ----: |
| Health (`/health`)                          |      ✅ |       ✅ |     ✅ |    ✅ |   ✅ |    ✅ |
| Auth (`/auth/*`)                            |      ✅ |       ✅ |     ✅ |    ✅ |   ✅ |    ✅ |
| Admin (`/admin/*`)                          |      ❌ |       ❌ |     ❌ |    ❌ |   ❌ |    ✅ |
| Ops/Partner (`/ops/*`)                      |      ❌ |       ⚠️ |     ⚠️ |    ❌ |   ✅ |    ✅ |
| Brand (`/brand/*`)                          |      ❌ |       ❌ |     ❌ |    ⚠️ |   ✅ |    ✅ |
| Products (`/products`, `/deals/*/redirect`) |      ✅ |       ❌ |     ❌ |    ❌ |   ❌ |    ❌ |
| Orders (`/orders/*`)                        |      ⚠️ |       ✅ |     ✅ |    ✅ |   ✅ |    ✅ |
| Tickets (`/tickets/*`)                      |      ⚠️ |       ⚠️ |     ⚠️ |    ⚠️ |   ✅ |    ✅ |
| AI (`/ai/*`)                                |    ✅\* |     ✅\* |   ✅\* |  ✅\* | ✅\* |  ✅\* |

\* AI routes are generally `optionalAuth` (some endpoints are `admin|ops` only).

## Scope rules (important)

### Orders

- `GET /orders/user/:userId`

  - shopper: only self
  - admin/ops: any user

- `POST /orders`

  - shopper only; cannot create orders for another user
  - campaign must be accessible to buyer lineage (agency allow-list OR mediator assignment)

- `POST /ops/verify`

  - admin/ops always allowed
  - mediator/agency allowed but scoped to their network
  - mediator self-verification for their own buyers is blocked

- `POST /ops/orders/settle`
  - admin/ops only
  - now debits brand wallet for payout before crediting buyer+mediator

### Tickets

- shopper: own tickets only
- brand/agency/mediator: tickets referencing orders within their scope OR their own tickets
- admin/ops: all tickets

### Brand connections

- `POST /ops/brands/connect`: agency-only intent; creates brand pending connection
- `POST /brand/requests/resolve`: brand/admin/ops; approves/rejects

## Follow-ups (next tightening)

- Standardize all “scoped list” endpoints to use shared helper(s) so scoping is consistent and testable.
- Add explicit policy tests for each role against key endpoints (403 vs 200) and for ownership violations.
