# MOBO Backend — Comprehensive Code Audit Report

> **Scope**: Every controller, model, service, route, validation, utility, and config file  
> **Focus**: Real bugs, security vulnerabilities, race conditions, missing edge cases, incomplete features  
> **Date**: Generated from full codebase read (~95 %+ of backend)

---

## Legend

| Severity | Meaning |
|----------|---------|
| **🔴 CRITICAL** | Will cause runtime failures, data corruption, or money loss |
| **🟠 HIGH** | Security vulnerability or significant logic flaw |
| **🟡 MEDIUM** | Missing edge case, scalability issue, or correctness concern |
| **🔵 LOW** | Improvement opportunity, minor inconsistency |

---

## 🔴 CRITICAL Issues

### C-1 · `copyCampaign` writes invalid enum value — Mongoose will reject the document

**File**: `controllers/opsController.ts` line 2585  
**Bug**: The copy sets `status: 'Active'` (capital A), but `CampaignStatus` in
`models/Campaign.ts:3` is `['draft', 'active', 'paused', 'completed']` (all
lowercase).  
Mongoose schema declares `enum: CampaignStatus`, so `CampaignModel.create()`
will throw a **ValidationError** every time a campaign is copied.

```ts
// opsController.ts:2585
status: 'Active',   // ← BUG: should be 'active'
```

**Fix**: Change to `status: 'active'`.

---

### C-2 · `getStats` / `getGrowth` load entire collections into Node memory

**File**: `controllers/adminController.ts` lines 117–175  
**Bug**: Both endpoints do:
```ts
UserModel.find({ deletedAt: null }).select({ role: 1 }).lean()
OrderModel.find({ deletedAt: null }).select({ totalPaise: 1, affiliateStatus: 1 }).lean()
```
With 100 K+ users/orders this will OOM the server.  The in-memory reduce/filter
loop that follows multiplies the cost.

**Fix**: Replace with MongoDB `$group` aggregation pipelines.  `getGrowth`
should use a date-range `$match` + `$dateToString` + `$group`.

---

### C-3 · `createOrder` reads campaign & checks slots OUTSIDE the transaction

**File**: `controllers/ordersController.ts` lines 230–365 vs. 391  
**Bug**: The campaign lookup, agency-access check, global-slot check, and
per-mediator slot check all run **before** `session.withTransaction()` on
line 391.  Between the read and the transactional write, another concurrent
request can consume the last slot, leading to **overselling**.

The atomic `$inc: { usedSlots: 1 }` inside the transaction does NOT have a
guard like `usedSlots: { $lt: totalSlots }`, so the slot count can exceed
`totalSlots`.

```ts
// line 359 — check passes
if ((campaign.usedSlots ?? 0) >= (campaign.totalSlots ?? 0)) { throw … }

// line 407 — unguarded increment (no $lt check)
await CampaignModel.updateOne(
  { _id: campaign._id },
  { $inc: { usedSlots: 1 } },
).session(session);
```

**Fix**: Either:
1. Move the campaign lookup inside the transaction and use
   `{ usedSlots: { $lt: campaign.totalSlots } }` as a filter on the
   `updateOne`, then check `modifiedCount === 0` to detect oversell, **or**
2. Use `findOneAndUpdate` with the same atomic guard.

---

### C-4 · `payoutAgency` silently writes a ledger record with no money transfer

**File**: `controllers/brandController.ts` lines ~360–430  
**Bug**: When `applyWalletDebit` fails with `INSUFFICIENT_FUNDS`, the handler
catches it and calls `recordManualPayoutLedger(…)` which creates a `Payout`
document with `mode: 'manual'`.  From the brand's perspective the UI shows
"payout recorded", but **no money actually moved**.  There is no indication back
to the brand that this was an unfunded ledger-only entry.

**Impact**: Brands may believe their agency was paid when funds were
insufficient.

**Fix**: Return a distinct response code/flag (e.g. `{ funded: false }`) so the
frontend can alert the brand that this is a *pending* manual payout, not a
completed one.

---

## 🟠 HIGH — Security

### H-1 · `getOrderProofPublic` exposes proof images without authentication

**File**: `controllers/ordersController.ts` lines 151–171  
**Route**: `GET /api/public/orders/:orderId/proof/:type` (no auth middleware)  
**Issue**: Anyone who knows (or brute-forces) a MongoDB ObjectId can download
order proof screenshots — these contain personal purchase history, names,
and potentially payment data.

A rate limiter (30 req / 5 min in prod) mitigates enumeration but does **not**
prevent a targeted attacker who already has an order ID (e.g. via a leaked URL
or log).

**Fix**: Require at minimum a short-lived signed token (HMAC of orderId +
expiry) or remove the public endpoint entirely.

---

### H-2 · Audit log endpoint allows agency/mediator to view ANY order's audit trail

**File**: `routes/ordersRoutes.ts` lines 52–75  
**Issue**: The audit endpoint treats `agency` and `mediator` roles as
`privileged`, granting them access to audit logs of **all** orders — including
orders from competing agencies/mediators:

```ts
const privileged = roles.some((r) =>
  ['admin', 'ops', 'agency', 'mediator'].includes(r)
);
```

Only `admin` and `ops` should be unconditionally privileged.  For
`agency`/`mediator`, the endpoint should verify the order belongs to their
network (same pattern used in `verifyOrderClaim`).

---

### H-3 · Ticket routes have no role restriction — any authenticated user can list/update/delete

**File**: `routes/ticketsRoutes.ts`  
**Issue**: Routes use `requireAuth` but NOT `requireRoles`.  While the
controller's `listTickets` does scope results by role, `updateTicket` and
`deleteTicket` only check ownership loosely.  A shopper could call
`PATCH /api/tickets/:id` with a guessed ticket ID and resolve someone else's
support ticket if the controller doesn't enforce ownership strictly enough.

`deleteTicket` requires `resolved`/`rejected` status but does NOT check that
the caller is the ticket creator or an admin.

**Fix**: Either add role guards on the routes, or add explicit
`createdBy === requesterId || isPrivileged` checks in `updateTicket` and
`deleteTicket`.

---

### H-4 · Google OAuth CSRF state stored in in-memory Map — lost on restart, not shared across instances

**File**: `routes/googleRoutes.ts` lines ~30–50  
**Issue**: The CSRF `stateStore` is a plain `Map<string, { userId, ts }>`.
In a multi-instance deployment (Render with multiple services, horizontal
scaling), the callback will hit a different instance that doesn't have the
state, causing all OAuth flows to fail with "Invalid state".

Additionally, there is no periodic cleanup — the entries accumulate until the
process restarts.

**Fix**: Use a Redis/DB-backed store, or at minimum encode the state as a
signed JWT so it is self-contained.

---

### H-5 · All in-memory rate-limit Maps reset on server restart

**Files**:
- `routes/aiRoutes.ts` — daily AI call limits
- `routes/mediaRoutes.ts` — per-IP image proxy limits
- `routes/googleRoutes.ts` — CSRF state

**Issue**: Any deploy or crash resets all rate-limit counters, allowing
attackers to immediately resume.  For AI endpoints with daily caps, this means
the cap can be bypassed by timing requests around deploys.

**Fix**: Use `rate-limit-redis` or `rate-limit-mongo` stores for the
express-rate-limit instances.  For the custom daily-limit Maps, back them with
a lightweight MongoDB counter collection.

---

### H-6 · `sheetsRoutes.ts` has no Zod validation — manual string parsing

**File**: `routes/sheetsRoutes.ts`  
**Issue**: Unlike every other route, the Sheets export endpoint validates input
via manual string checks (`if (!type || ...)`) instead of Zod schemas.  This
inconsistency means there is no schema-level type coercion, no `.trim()`, and
potential for unexpected `undefined` values leaking through.

More critically, the 50 000 row safety limit is enforced on the `rows` array
after it is built — meaning all the data has already been loaded into memory
before the check fires.

---

## 🟡 MEDIUM — Logic & Edge Cases

### M-1 · Hardcoded query limits with no pagination

**Files & limits**:
| File | Endpoint | Limit |
|------|----------|-------|
| `adminController.ts:89` | `getUsers` | 5 000 |
| `adminController.ts:107` | `getFinancials` | 5 000 |
| `brandController.ts` | `getOrders`, `getTransactions` | 5 000 |
| `ordersController.ts` | `getUserOrders` | 2 000 |
| `productsController.ts` | `listProducts` | 2 000 |
| `inviteController.ts` | `adminListInvites` | 500 |

**Issue**: No offset/cursor pagination is offered.  Once a user exceeds the
limit, newer records silently disappear from the response.

**Fix**: Add `page`/`limit` query params (with sensible max) across all list
endpoints.

---

### M-2 · `COOLING_PERIOD_DAYS = 14` is hardcoded

**File**: `controllers/opsController.ts` line 116  
**Issue**: The settlement cooling period that determines when Brands can settle
orders is a magic constant.  Changing it requires a code deploy.

**Fix**: Move to `SystemConfig` collection (already exists) or to env vars.

---

### M-3 · `publishDealSchema` allows negative commission

**File**: `validations/ops.ts`  
**Issue**: `commissionPaise` is validated with `.int()` only — no
`.nonnegative()`.  Meanwhile the sibling `assignSlotsSchema` uses
`.nonnegative()` for commission.  A negative commission would mean the mediator
pays to promote a deal.

**Fix**: Add `.nonnegative()` (or `.positive()`) to `commissionPaise` in
`publishDealSchema`.

---

### M-4 · Brand campaign `image` / `productUrl` validated only as non-empty strings

**File**: `validations/brand.ts`  
**Issue**: `createBrandCampaignSchema` accepts `image: z.string().min(1)` and
`productUrl: z.string().min(1)`.  No URL format validation and no max length.
An attacker could supply a megabyte-long string or `javascript:` URI.

**Fix**: Use `z.string().url().max(2048)` for both fields.

---

### M-5 · `realtimeHub` EventEmitter 500-listener cap may be exceeded

**File**: `services/realtimeHub.ts`  
**Issue**: `setMaxListeners(500)` is a soft cap.  Each SSE client adds a
listener.  Beyond 500 concurrent SSE connections, Node.js will emit a
`MaxListenersExceededWarning` and potentially leak.

**Fix**: Use a proper pub/sub mechanism (Redis Pub/Sub, or a bounded
subscription pool with back-pressure).

---

### M-6 · `trackRedirect` creates a pre-order without checking deal inventory

**File**: `controllers/productsController.ts`  
**Issue**: `trackRedirect` creates an order in `REDIRECTED` state without
checking if the campaign has available slots.  This means arbitrarily many
pre-orders can be created, and when the buyer later upgrades to `ORDERED` the
slot check may fail — producing a confusing UX.

**Fix**: Check slot availability at redirect time and return a warning/error if
the campaign is already sold out.

---

### M-7 · `assignSlots` optimistic concurrency retry is missing

**File**: `controllers/opsController.ts` (search for `__v`)  
**Issue**: The slot assignment uses Mongoose `__v` (version key) for optimistic
locking, but there is **no retry loop**.  If two ops users assign slots to the
same campaign simultaneously, one will get a silent failure (match count 0) with
no error — the save just doesn't happen.

**Fix**: Add a retry loop (2-3 attempts) or use `findOneAndUpdate` with an
atomic operation.

---

### M-8 · `sheetsService.ts` `makePublicReadable` — service-account fallback exposes sheet to anyone

**File**: `services/sheetsService.ts` lines 305–320  
**Issue**: When the export uses a service account AND the user's email is
unknown, the sheet is made **readable by anyone with the link**.  This means
the exported order/payout data (potentially containing PII) is publicly
accessible on the internet.

**Fix**: Always require `sharingEmail` and return an error if unavailable,
rather than falling back to public access.

---

### M-9 · `paiseToRupees` loses precision for certain values

**File**: `utils/money.ts`  
**Code**:
```ts
export function paiseToRupees(paise: number) { return Math.round(paise) / 100; }
```
**Issue**: `Math.round(paise) / 100` is fine if `paise` is always an integer,
but there is no runtime guard.  If a fractional paise value arrives (e.g. from
a percentage calculation upstream), the rounding silently absorbs the error.
`rupeesToPaise(0.1 + 0.2)` → `30` (correct due to `Math.round`), but
intermediate floating-point arithmetic elsewhere could produce off-by-one paise.

**Fix**: Assert `Number.isInteger(paise)` at entry, or use a dedicated
money library.

---

### M-10 · `consumeInvite` expired-status update outside transaction may conflict

**File**: `services/invites.ts`  
**Issue**: When an invite is found to be expired during consumption, the status
is updated with `{ session: undefined }` (explicitly outside the caller's
MongoDB transaction).  If two concurrent requests both discover the same invite
expired at the same instant, both will try to update it — the second gets a
no-op.  More importantly, if the outer transaction rolls back for a different
reason, the invite's status has already been permanently changed to `'expired'`
even though consumption didn't succeed.

**Impact**: Low, because expiration is idempotent, but it's a correctness smell.

---

### M-11 · Notifications controller loads all buyer orders on every request

**File**: `controllers/notificationsController.ts`  
**Issue**: Every call to `GET /api/notifications` for a shopper runs:
```ts
OrderModel.find({ userId, deletedAt: null }).sort({ updatedAt: -1 }).limit(100).lean()
```
With no caching, this is a full collection scan per page load.  Mediator
notifications additionally load pending shoppers, pending orders, and recent
payouts — all in serial.

**Fix**: Introduce a pre-computed `NotificationFeed` collection updated by
background event handlers, or add short-TTL in-memory/Redis caching.

---

### M-12 · `updateCampaign` locks only after first order — economics can be changed mid-workflow

**File**: `controllers/brandController.ts` (search for `locked`)  
**Issue**: Campaign economics (price, payout, commission) are locked by setting
`locked: true` on the first order creation.  But between campaign creation and
the first order, a brand can change economics — any mediator who saw the
original deal terms and redirected a buyer will find different terms when the
order is placed.

**Fix**: Lock on first deal publish rather than first order, or snapshot
economics into the Deal document at publish time (partially done via
`commissionPaise` on Deal, but not for `pricePaise`/`payoutPaise`).

---

## 🔵 LOW — Improvements & Minor Issues

### L-1 · `lineage.ts` queries DB on every call with no caching

**File**: `services/lineage.ts`  
**Issue**: `isAgencyActive`, `isMediatorActive`, `getAgencyCodeForMediatorCode`
are called on hot paths (every order verification).  Each does a fresh DB
query.

**Fix**: Add a short-TTL cache (30 s) keyed by agencyCode/mediatorCode.

---

### L-2 · Abundant `as any` casts suggest incomplete TypeScript coverage

**Files**: Throughout controllers  
Examples: `(campaign as any).brandUserId`, `(order as any).frozen`,
`(campaign as any).allowedAgencyCodes`.

These suggest the Mongoose document types are missing fields that are actually
present in the schema.  This hides type errors at compile time.

**Fix**: Generate or hand-write complete Mongoose document interfaces.

---

### L-3 · JWT secrets auto-generated in dev/test — tokens invalidated on every restart

**File**: `config/env.ts`  
**Issue**: When `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are unset in
dev/test, a random value is generated.  This means every `npm run dev` restart
invalidates all existing tokens, forcing re-login.

**Impact**: Developer friction only.  Not a production issue (prod requires
secrets ≥ 20 chars).

---

### L-4 · `getStats` role counter uses `u.role` (singular) but model stores `roles` (array)

**File**: `controllers/adminController.ts` line ~128  
**Code**: `const ui = toUiRole(String(u.role));`  
**Issue**: The User model field is `roles` (array), not `role`.  `u.role` is
`undefined`, so `toUiRole('undefined')` is called.  The mapping function likely
has a default case, but the per-role counts in `getStats` will always be 0.

**Fix**: Use `u.roles?.[0]` or iterate the array.

---

### L-5 · `updateUserStatus` cascade doesn't restore downstream on reactivation

**File**: `controllers/adminController.ts`  
**Issue**: When a user is suspended, downstream entities are frozen
(orders, deals, mediator status).  But there is no corresponding
"un-suspend" cascade — reactivating a user only changes their own status,
leaving downstream orders/deals/mediators frozen.

**Fix**: Add a reactivation cascade, or document that manual intervention is
needed.

---

### L-6 · `deleteTicket` doesn't verify caller is ticket creator or admin

**File**: `controllers/ticketsController.ts`  
**Issue**: The endpoint checks `status === 'resolved' || 'rejected'` but does
not verify that the caller is the ticket's creator.  Any logged-in user could
delete someone else's resolved ticket if they know the ID.

---

### L-7 · `createCampaign` auto-connects allowed agencies without agency consent

**File**: `controllers/brandController.ts`  
**Issue**: When a brand creates a campaign with `allowedAgencyCodes`, the code
automatically creates Agency↔Brand connection documents.  The agency is never
asked to accept/decline this connection.

**Impact**: Agencies may find themselves connected to brands they never approved.

---

### L-8 · No compound indexes on hot query patterns

**Files**: `ordersController.ts`, `opsController.ts`  
**Issue**: Many queries filter by compound conditions
(`{ userId, deletedAt: null }`, `{ managerName, campaignId, status }`) but
there are no compound indexes defined in the models for these patterns.
The models only define single-field indexes.

**Fix**: Add compound indexes for the most common query patterns.

---

### L-9 · `healthRoutes` E2E readiness check probes localhost dev servers unconditionally

**File**: `routes/healthRoutes.ts`  
**Issue**: The `/api/e2e-ready` endpoint tries to connect to
`localhost:3001-3005` (frontend dev servers) even in production.  If called, it
will time out or error.

**Mitigating factor**: It is only used by E2E tests, but should be gated behind
`NODE_ENV !== 'production'`.

---

### L-10 · `mediaRoutes` SSRF check doesn't handle IPv6-mapped IPv4

**File**: `routes/mediaRoutes.ts`  
**Issue**: The `isPrivateHost` function checks common private IPv4 ranges and
a few IPv6 patterns, but does not block IPv6-mapped IPv4 addresses like
`::ffff:127.0.0.1` or `::ffff:10.0.0.1` in all representations (e.g.,
URL-encoded or bracket-wrapped forms).

**Fix**: Resolve the hostname to IP first via `dns.lookup()`, then check the
numeric IP against all private ranges including mapped forms.

---

## Summary Table

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 CRITICAL | 4 | Data integrity, money flow, overselling |
| 🟠 HIGH | 6 | Security, auth bypass, state loss |
| 🟡 MEDIUM | 12 | Logic gaps, scalability, edge cases |
| 🔵 LOW | 10 | Typing, DX, minor correctness |
| **Total** | **32** | |

---

## Top 5 Priorities (by business impact)

1. **C-1** — Fix `copyCampaign` enum casing → campaigns can't be copied at all right now
2. **C-3** — Fix slot overselling race condition → direct revenue loss
3. **H-1** — Protect or remove public proof endpoint → PII exposure
4. **C-2** — Replace in-memory aggregation → server crashes at scale
5. **H-2** — Scope audit endpoint to network → data leakage across agencies
