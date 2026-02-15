# Backend Code Audit Report

**Generated:** 2025-01-XX  
**Scope:** `controllers/`, `routes/`, `middleware/`, `validations/`, selected `services/`, `config/env.ts`  
**Files audited:** 41 files across 7 directories

---

## CRITICAL (5 issues)

### C-1. Unauthenticated public proof endpoint leaks buyer PII images

**File:** `backend/controllers/ordersController.ts` L151–L172  
**Route:** `backend/routes/ordersRoutes.ts` L48  

The `getOrderProofPublic` endpoint serves order proof screenshots (purchase receipts, rating screenshots, return window images) to **anyone** who knows or brute-forces a MongoDB ObjectId. There is no authentication, no ownership check, and no link-signing — only a lenient rate limit (30/min).

```ts
// ordersRoutes.ts L48 — NO requireAuth, NO ownerOrPrivileged
router.get('/public/orders/:orderId/proof/:type', publicProofLimiter, orders.getOrderProofPublic);
```

```ts
// ordersController.ts L151
getOrderProofPublic: async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    const proofType = String(req.params.type || '').trim().toLowerCase();
    // ... no auth check at all
    const order = await findOrderForProof(orderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    const proofValue = resolveProofValue(order, proofType);
    sendProofResponse(res, proofValue);
  } catch (err) { next(err); }
},
```

**Impact:** Any attacker can enumerate order IDs and download buyer proof images containing sensitive data (order screenshots with names, addresses, payment details; rating screenshots with buyer profile names).  
**Fix:** Add authentication, or use signed short-lived URLs, or add a per-order bearer token.

---

### C-2. Settlement wallet movements are not atomic with order status update

**File:** `backend/controllers/opsController.ts` L1486–L1555  

In `settleOrderPayment`, the wallet debit/credit happens inside a MongoDB transaction (`settlementSession`), but the order status update (`order.save()`) and workflow transitions (`transitionOrderWorkflow`) happen **outside** that session, after `settlementSession.endSession()`.

If the wallet transaction succeeds but `order.save()` fails (e.g., network issue, validation error), money has been moved but the order remains in `APPROVED` state — money is lost from the brand's wallet with no record on the order.

```ts
// L1510-1511: session ends
} finally {
    settlementSession.endSession();
}
// L1514-1530: order update OUTSIDE transaction
order.paymentStatus = isOverLimit ? 'Failed' : 'Paid';
order.affiliateStatus = isOverLimit ? 'Cap_Exceeded' : 'Approved_Settled';
// ...
await order.save(); // L1530 — can fail independently

// L1533-1548: workflow transitions — also outside transaction
await transitionOrderWorkflow({ orderId: String(order._id), from: 'APPROVED', to: 'REWARD_PENDING', ... });
await transitionOrderWorkflow({ orderId: String(order._id), from: 'REWARD_PENDING', to: isOverLimit ? 'FAILED' : 'COMPLETED', ... });
```

**Impact:** Money creation/destruction on partial failure. Brand wallet debited, buyer/mediator credited, but order shows no settlement occurred.  
**Fix:** Include the `order.save()` and workflow transitions inside the same transaction session, or use a saga/compensation pattern.

---

### C-3. Unsettlement doesn't ensure buyer wallet exists before debiting

**File:** `backend/controllers/opsController.ts` L1632–L1700  

In `unsettleOrderPayment`, `ensureWallet(brandId)` is called to ensure the brand wallet exists for credit-back, but `ensureWallet(buyerUserId)` is **never called** before debiting the buyer's commission. If the buyer's wallet was deleted (via admin `deleteWallet`), the debit throws `WALLET_NOT_FOUND`, leaving the brand credit applied but buyer/mediator debits unexecuted.

```ts
// L1654: Only brand wallet is ensured
await ensureWallet(brandId);

// L1666-1685: buyer debit happens WITHOUT ensureWallet(buyerUserId)
await unsettleSession.withTransaction(async () => {
  await applyWalletCredit({ ownerUserId: brandId, ... });  // credit brand ✓
  if (buyerCommissionPaise > 0) {
    await applyWalletDebit({ ownerUserId: buyerUserId, ... });  // debit buyer — wallet may not exist!
  }
  // ...
});
```

**Impact:** Partial unsettlement: brand gets money back but buyer/mediator keep their credits. Ledger inconsistency.  
**Fix:** Add `await ensureWallet(buyerUserId);` before the unsettlement session.

---

### C-4. payoutMediator fallback idempotency key uses `Date.now()`

**File:** `backend/controllers/opsController.ts` L2390–L2396  

When no `x-request-id` header is present, the idempotency key falls back to `MANUAL-${Date.now()}`, which generates a different key on every retry. This completely defeats idempotency protection for the wallet debit, allowing double-payout on network retries.

```ts
// L2390-2396
const requestId = String(
  (req as any).headers?.['x-request-id'] ||
  (res.locals as any)?.requestId || ''
).trim();
const idempotencySuffix = requestId || `MANUAL-${Date.now()}`;
```

**Impact:** If a mediator payout request is retried (e.g., timeout → retry), each attempt creates a separate payout and wallet debit. Money can be drained.  
**Fix:** Require `x-request-id` for financial endpoints, or generate the idempotency key from deterministic fields (`mediatorId + amount + date`).

---

### C-5. SSRF bypass via DNS rebinding in image proxy

**File:** `backend/routes/mediaRoutes.ts` L36–L62, L78–L130  

The `isPrivateHost` check validates the hostname string **before** the `fetch()` call, but the DNS resolution happens during `fetch()`. An attacker can use a DNS rebinding domain that resolves to a public IP on first lookup (passing the check) and a private/metadata IP on the actual fetch.

Additionally, `0.0.0.0` is not blocked, and the check doesn't cover all cloud metadata endpoints (e.g., `169.254.169.254` is blocked, but not all cloud providers' metadata services).

```ts
// L62 — checked before fetch, but DNS can change
if (isPrivateHost(target.hostname)) {
  res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'private addresses not allowed' } });
  return;
}
// L80+ — fetch happens later, DNS may resolve differently
const response = await fetch(target.toString(), { ... });
```

**Impact:** Server-side request forgery (SSRF) allowing access to internal services, cloud metadata endpoints (AWS/GCP IAM credentials), and internal network scanning.  
**Fix:** Resolve DNS before fetch and validate the resolved IP, or use an allowlist-based approach. Block `0.0.0.0` explicitly.

---

## HIGH (8 issues)

### H-1. `getUserOrders` does not restrict mediator/agency/brand access to their own scope

**File:** `backend/controllers/ordersController.ts` L176–L197  

The `getUserOrders` handler allows any privileged role (admin, ops, agency, mediator, brand) to fetch **any user's orders** without verifying the orders belong to their network scope (e.g., a mediator can view orders of a buyer in a different agency's network).

```ts
// L176-197
const requesterId = req.auth?.userId;
const requesterRoles = req.auth?.roles ?? [];
const privileged = requesterRoles.includes('admin') || requesterRoles.includes('ops');
if (!privileged && requesterId !== userId) {
  throw new AppError(403, 'FORBIDDEN', 'Cannot access other user orders');
}
// 'agency' and 'mediator' roles are NOT in privileged, BUT ...
```

Wait — re-reading: `privileged` only includes admin/ops. The `ownerOrPrivileged` middleware in `ordersRoutes.ts` L40 however treats ALL non-shopper roles as privileged:

```ts
// ordersRoutes.ts L40-44
const isPrivileged = roles.some((r: string) => ['admin', 'ops', 'agency', 'mediator', 'brand'].includes(r));
if (!isPrivileged && auth?.userId !== requestedUserId) {
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
}
```

**Impact:** Any agency, mediator, or brand can view any buyer's full order history, including orders outside their network. Information disclosure across tenant boundaries.  
**Fix:** Scope the route middleware to only allow admin/ops full access; for agency/mediator, verify the orders belong to their lineage.

---

### H-2. `requireAuthOrToken` is identical dead code

**File:** `backend/middleware/auth.ts` L126–L143  

`requireAuthOrToken` is a 1:1 duplicate of `requireAuth` with no functional difference. It's used for the authenticated proof endpoint but provides no additional capability (e.g., no API-key or link-token support).

```ts
// L126-143 — identical logic to requireAuth (L106-123)
export function requireAuthOrToken(env: Env) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') || '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!token) { return next(new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token')); }
    try {
      req.auth = await resolveAuthFromToken(token, env);
      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    }
  };
}
```

**Impact:** Dead code that misleads developers into believing the proof endpoint has an alternative auth path (e.g., link tokens), potentially delaying proper auth implementation.  
**Fix:** Remove `requireAuthOrToken` and use `requireAuth` everywhere, or implement the intended alternative auth mechanism.

---

### H-3. Google OAuth CSRF state stored in-memory only

**File:** `backend/routes/googleRoutes.ts` L48–L56  

The `pendingStates` Map for CSRF protection during Google OAuth is stored in process memory. It is lost on restart and not shared across instances in multi-worker/multi-instance deployments.

```ts
// L48
const pendingStates = new Map<string, { userId: string; createdAt: number }>();
```

**Impact:** In multi-instance deployments, the callback may hit a different instance than the one that created the CSRF state, causing all OAuth flows to fail. On restart, all in-flight OAuth flows are invalidated (minor DoS). More critically, if state validation fails silently, CSRF attacks become possible.  
**Fix:** Store CSRF states in the database (MongoDB) or Redis.

---

### H-4. Broad opsRoutes role gate allows cross-role endpoint access

**File:** `backend/routes/opsRoutes.ts` L14  

The opsRoutes router uses `requireRoles('agency', 'mediator', 'ops', 'admin')`, giving all four roles access to the entire route tree. While individual controller handlers check role-specific permissions, the router-level check is too permissive.

```ts
// L14
router.use(requireRoles('agency', 'mediator', 'ops', 'admin'));
```

Routes like `POST /ops/users/approve`, `POST /ops/users/reject`, and `POST /ops/orders/settle` are admin/ops-level operations. A mediator can hit these and gets a 403 from the controller, but the router-level guard should enforce tighter defaults.

**Impact:** Increased attack surface — any authenticated user with `agency` or `mediator` role can probe all ops endpoints. Controller-level checks must be flawless or authorization bypasses are possible.  
**Fix:** Split ops routes into sub-routers with role-appropriate guards, or add per-route role middleware.

---

### H-5. Auth middleware makes 1–3 DB queries per request for upstream suspension checks

**File:** `backend/middleware/auth.ts` L39–L100  

Every authenticated request triggers:
1. `UserModel.findById(userId)` — always
2. For mediators: `UserModel.findOne({ mediatorCode: parentCode, roles: 'agency' })` — agency check
3. For shoppers: `UserModel.findOne({ mediatorCode: parentCode, roles: 'mediator' })` + `UserModel.findOne({ mediatorCode: agencyCode, roles: 'agency' })` — mediator + agency check

This is **3 sequential DB queries** for every shopper request and **2 queries** for every mediator request.

```ts
// L48-100 — chained DB calls for every request
const user = await UserModel.findById(userId).select({...}).lean();
// ...
if (roles.includes('mediator')) {
  if (parentCode) {
    const agency = await UserModel.findOne({...}).lean(); // 2nd query
  }
}
if (roles.includes('shopper')) {
  if (parentCode) {
    const mediator = await UserModel.findOne({...}).lean(); // 2nd query
    const agencyCode = String((mediator as any).parentCode || '').trim();
    if (agencyCode) {
      const agency = await UserModel.findOne({...}).lean(); // 3rd query
    }
  }
}
```

**Impact:** Significant latency added to every request for buyer-facing endpoints. With concurrent buyers, this creates a DB bottleneck.  
**Fix:** Cache user status/suspension state in Redis (or in-memory with short TTL). Consider denormalization: store `isLineageActive` on the user document, updated on suspension cascade.

---

### H-6. `getTransactions` returns 1000 transactions with no access control scoping

**File:** `backend/controllers/opsController.ts` L2503–L2513  

The `getTransactions` endpoint returns the last 1000 transactions for **all users** without any scope filtering. Any user with ops router access (agency, mediator, ops, admin) can view all financial transactions.

```ts
// L2505-2513
getTransactions: async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tx = await TransactionModel.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();
    res.json(tx);
  } catch (err) { next(err); }
},
```

**Impact:** Financial data disclosure — agencies and mediators can see all platform transactions, including those from other agencies/brands.  
**Fix:** Scope transactions to the requester's wallet/network. Add pagination.

---

### H-7. Order proof `type` parameter not validated against a safe allowlist in `getOrderProof`

**File:** `backend/controllers/ordersController.ts` L96–L148  

The authenticated `getOrderProof` endpoint validates the type against `allowedTypes` but then uses property access with the normalized key on `order.screenshots`. The `getOrderProofPublic` (L157) does validate against an allowlist, but the private endpoint at L96 does not show the same validation in the summary context. More critically, the `resolveProofValue` helper accesses `order.screenshots[proofType]` which could expose unintended fields if the screenshots object contains unexpected keys.

```ts
// L163 (public) — validated ✓
const allowedTypes = new Set(['order', 'payment', 'rating', 'review', 'returnwindow']);
if (!allowedTypes.has(proofType)) { ... }

// L96 (private) — uses role-based access but similar pattern
```

**Impact:** Low-severity data access if `screenshots` object contains unexpected keys. The public endpoint is properly validated.  
**Fix:** Ensure both endpoints validate `proofType` against the same allowlist before property access.

---

### H-8. Brand `payoutAgency` manual ledger fallback bypasses wallet transaction integrity

**File:** `backend/controllers/brandController.ts` L302–L370  

When brand wallet has insufficient funds, `payoutAgency` falls back to creating a manual payout record without a wallet debit. This creates a payout entry that isn't backed by actual money movement.

```ts
// brandController.ts — payoutAgency
// If wallet debit fails:
const payout = await PayoutModel.create({
  amountPaise, status: 'pending_manual',
  provider: 'manual',
  // ... created without wallet debit
});
```

**Impact:** Payouts can be recorded without corresponding wallet debits, creating ledger discrepancies. Brands could accumulate payout obligations exceeding their wallet balance.  
**Fix:** Either enforce wallet balance requirements strictly, or clearly separate manual/offline payouts from wallet-backed payouts with different audit trails.

---

## MEDIUM (12 issues)

### M-1. `writeAuditLog` called without `await` in 10+ locations

**Files:**  
- `backend/services/orderWorkflow.ts` L103, L145, L187  
- `backend/services/walletService.ts` L115, L122, L198, L205  
- `backend/routes/googleRoutes.ts` ~L199  
- `backend/controllers/productsController.ts` (trackRedirect)  

The `writeAuditLog` function is `async` and its errors are caught internally (won't crash), but calling it without `await` means:
1. The caller doesn't know if the audit log was written.
2. In high-throughput scenarios, unresolved promises accumulate.
3. Security-relevant events may be silently lost.

```ts
// orderWorkflow.ts L103 — no await
writeAuditLog({
  action: 'ORDER_WORKFLOW_TRANSITION',
  entityType: 'Order',
  entityId: params.orderId,
  metadata: { from: params.from, to: params.to, actorUserId: params.actorUserId },
});
```

**Impact:** Audit trail gaps for workflow transitions, wallet mutations, and OAuth events.  
**Fix:** Await the calls OR use a background queue with guaranteed delivery (e.g., write to a local buffer that a worker flushes).

---

### M-2. In-memory rate limiting resets on restart and is per-instance

**File:** `backend/routes/aiRoutes.ts` L142–L148  

The `dailyUsage` and `lastCallAt` Maps live in process memory. In multi-worker or multi-instance deployments, each instance has its own counters.

```ts
// L142-143
const dailyUsage = new Map<string, { day: string; count: number }>();
const lastCallAt = new Map<string, number>();
```

The code even acknowledges this:
```ts
// ⚠ DEPLOYMENT NOTE: These rate-limit Maps live in process memory.
// ... For production with multiple instances, replace with Redis-backed stores
```

**Impact:** AI rate limits are ineffective in multi-instance deployments. Users can bypass daily quotas by hitting different instances.  
**Fix:** Use Redis-backed rate limiting (e.g., `rate-limit-redis`).

---

### M-3. Unbounded `.limit(5000)` queries across 16 endpoints

**Files (with line numbers):**  
- `backend/controllers/adminController.ts` L89, L109, L194  
- `backend/controllers/brandController.ts` L129, L154  
- `backend/controllers/opsController.ts` L238, L277, L355, L397, L428, L460  
- `backend/controllers/ticketsController.ts` L64, L75, L88, L148, L167  

All these queries fetch up to 5000 documents in a single request with no pagination. For a growing platform, this becomes a performance and memory concern.

```ts
// adminController.ts L89
const users = await UserModel.find(query).sort({ createdAt: -1 }).limit(5000).lean();
```

**Impact:** Slow responses, high memory usage, potential OOM on large datasets. Also transmits potentially megabytes of JSON over the wire.  
**Fix:** Implement cursor-based or offset pagination with a reasonable page size (50-100).

---

### M-4. Missing ObjectId validation on many endpoints

**Files:**  
- `backend/validations/ops.ts` — `verifyOrderSchema`, `approveByIdSchema`, `rejectByIdSchema`, `settleOrderSchema`, `unsettleOrderSchema`, `payoutMediatorSchema` all use `z.string().min(1)` without ObjectId format validation  
- `backend/validations/admin.ts` — `updateUserStatusSchema`, `reactivateOrderSchema` — same  
- `backend/validations/tickets.ts` — `createTicketSchema` orderId — same  

```ts
// ops.ts
export const verifyOrderSchema = z.object({
  orderId: z.string().min(1),  // accepts any non-empty string
});
```

While the global error handler catches Mongoose `CastError` and returns 400, validation should reject invalid IDs before hitting the DB.

**Impact:** Invalid IDs hit the database (wasted round-trip), and the CastError handler may not catch all edge cases (e.g., a valid-length hex string that isn't a real ObjectId).  
**Fix:** Add `.regex(/^[0-9a-fA-F]{24}$/)` to all ObjectId fields in validation schemas (as `brand.ts` already does).

---

### M-5. EventEmitter maxListeners cap may be exceeded under load

**File:** `backend/services/realtimeHub.ts` L28  

```ts
emitter.setMaxListeners(500);
```

Each SSE client adds a listener. With more than 500 concurrent SSE connections, Node.js will emit a warning and potentially degrade. There's no graceful rejection or backpressure mechanism.

**Impact:** Memory leak warning and degraded realtime performance when SSE connections exceed 500.  
**Fix:** Track active connections with a counter and reject new SSE connections with 503 when at capacity, or increase the limit dynamically. Consider a pub/sub system (Redis Streams) for horizontal scaling.

---

### M-6. `adminListInvites` returns raw Mongoose documents

**File:** `backend/controllers/inviteController.ts`  

The `adminListInvites` handler returns invite documents directly without field projection or mapping, potentially exposing internal fields.

**Impact:** Internal Mongoose fields (`__v`, `_id` format), and potentially sensitive fields are exposed through the API.  
**Fix:** Add a `.select()` projection or use a `toUiInvite()` mapper function.

---

### M-7. Bank details validation is too permissive

**File:** `backend/validations/auth.ts` L68–L75  

Bank details fields accept arbitrary strings up to a length limit. IFSC codes and account numbers have known formats that should be validated.

```ts
bankDetails: z.object({
  accountNumber: optionalNonEmptyString(64),  // no format validation
  ifsc: optionalNonEmptyString(32),           // no format validation (should be 4+0+6)
  bankName: optionalNonEmptyString(120),
  holderName: optionalNonEmptyString(120),
}).optional(),
```

**Impact:** Invalid bank details stored in database, causing payout failures at settlement time.  
**Fix:** Add format validation: `ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)`.

---

### M-8. `createOrder` reads campaign and deal outside the transaction

**File:** `backend/controllers/ordersController.ts` L314–L390  

The campaign lookup, deal lookup, and slot availability check happen before `session.withTransaction()`. Another concurrent request could consume the last slot between the check and the actual slot increment.

```ts
// L314: campaign lookup — outside transaction
const campaign = await CampaignModel.findOne({ _id: item.campaignId, ... }).session(session);
// ...
// L391: transaction begins
const created = await session.withTransaction(async () => { ... });
```

Note: The `.session(session)` on L317 attaches the read to the session but the transaction hasn't started yet, so there's no snapshot isolation.

**Impact:** Race condition: two buyers could both pass the slot check and both consume the last slot, resulting in over-allocation.  
**Fix:** Move the campaign/slot check inside `session.withTransaction()` to get snapshot isolation.

---

### M-9. `imageProxy` memory usage with large images

**File:** `backend/routes/mediaRoutes.ts` L118–L125  

The image proxy downloads the entire image into memory via `response.arrayBuffer()` before sending it to the client. With a 4MB limit and many concurrent requests, this can cause significant memory pressure.

```ts
const arrayBuffer = await response.arrayBuffer();
if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
  res.status(413).end();
  return;
}
res.send(Buffer.from(arrayBuffer));
```

**Impact:** Under concurrent load, each proxied image request consumes up to 4MB of heap. 100 concurrent requests = 400MB.  
**Fix:** Stream the response instead of buffering: pipe `response.body` to `res` with a byte counter that aborts on exceeding `MAX_IMAGE_BYTES`.

---

### M-10. `updateCampaign` in brandController doesn't validate `status` field values

**File:** `backend/controllers/brandController.ts` ~L570–L600, `backend/validations/brand.ts` L40  

The `updateBrandCampaignSchema` allows `status: z.string().min(1).max(30).optional()` — any string up to 30 chars. Unlike `updateCampaignStatusSchema` in ops.ts which uses `z.enum(...)`, the brand campaign update accepts arbitrary status values.

```ts
// brand.ts validation
status: z.string().min(1).max(30).optional(),  // accepts "invalid_status"!
```

**Impact:** Brands could set campaigns to invalid status values, potentially breaking workflow logic that depends on status matching known values.  
**Fix:** Change to `z.enum(['active', 'paused', 'completed', 'draft']).optional()`.

---

### M-11. Invite code collision retry only 5 times

**File:** `backend/controllers/inviteController.ts`  

Invite code generation uses a 5-retry loop for collision avoidance. With a growing invite table, the probability of collision increases.

**Impact:** Under high concurrency or with many existing codes, invite creation could fail unexpectedly.  
**Fix:** Use a longer code format to reduce collision probability, or retry more times, or use a sequential component in the code.

---

### M-12. `ipHits` Map in mediaRoutes can grow unbounded between purge intervals

**File:** `backend/routes/mediaRoutes.ts` L17–L30  

The in-memory `ipHits` Map is purged every 2 minutes, but under a DDoS with many unique IPs, the Map can grow to millions of entries between purges.

```ts
const ipHits = new Map<string, { count: number; resetAt: number }>();
// ...
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now >= entry.resetAt) ipHits.delete(ip);
  }
}, RATE_WINDOW_MS * 2).unref(); // purge every 2 min
```

**Impact:** Memory exhaustion under distributed DDoS attack with many unique source IPs.  
**Fix:** Use `express-rate-limit` with an external store, or add a max-size cap to the Map.

---

## LOW (8 issues)

### L-1. `notificationsController` computes notifications on every call instead of caching

**File:** `backend/controllers/notificationsController.ts`  

The notification builder performs multiple DB queries (orders, users, payouts) on every GET request to compute the notification list. There is no persistent notification model or caching.

**Impact:** High DB load for frequently accessed notification endpoints (polling UI).  
**Fix:** Consider a persistent notification model or short-lived cache.

---

### L-2. Multiple `(order as any)` type casts throughout controllers

**Files:** `backend/controllers/opsController.ts`, `backend/controllers/ordersController.ts`, `backend/controllers/brandController.ts`  

Extensive use of `(order as any)` to bypass TypeScript's type system, indicating the Mongoose model types don't match actual document shapes.

```ts
(order as any).verification = (order as any).verification ?? {};
(order as any).verification.order = (order as any).verification.order ?? {};
(order as any).verification.order.verifiedAt = new Date();
```

**Impact:** Type safety is completely bypassed. Typos in field names, missing required fields, and type mismatches will not be caught at compile time.  
**Fix:** Update the `Order` model interface to include all fields used in controllers (verification, frozen, frozenAt, workflowStatus, etc.).

---

### L-3. `sendPushToUser` errors swallowed with `.catch(() => {})`

**File:** `backend/controllers/opsController.ts` L1047, and multiple other locations  

```ts
await sendPushToUser({ ... }).catch(() => {});
```

Push notification failures are silently swallowed with no logging, making it impossible to diagnose delivery issues.

**Impact:** Push notifications may silently fail with no diagnostic trail.  
**Fix:** Use `.catch((err) => console.warn('[push]', err.message))` at minimum.

---

### L-4. `deleteUser` pre-flight queries don't use transactions

**File:** `backend/controllers/adminController.ts` (deleteUser handler)  

The pre-flight checks (campaigns, deals, orders, payouts, wallet balance) and the actual deletion are not wrapped in a transaction. Between the checks and the deletion, new orders/campaigns could be created.

**Impact:** TOCTOU race: a user could place an order after the check but before the delete, bypassing the safety guards.  
**Fix:** Wrap the checks and deletion in a transaction.

---

### L-5. `parseCorsOrigins` allows non-standard wildcard patterns

**File:** `backend/config/env.ts` L133–L167  

The CORS origin parser handles wildcard patterns (e.g., `*.vercel.app`) but doesn't validate the wildcards conform to expected patterns. Malformed wildcard entries could either fail silently or match unintended origins.

**Impact:** Misconfigured CORS entries may not match as expected, potentially either blocking legitimate traffic or allowing unintended origins.  
**Fix:** Document the expected wildcard format and validate entries.

---

### L-6. No rate limit on `POST /api/admin/orders/reactivate`

**File:** `backend/routes/adminRoutes.ts`  

While admin routes have a general 900 req/15min limiter, the `reactivateOrder` endpoint (which unfreezes orders) has no stricter limit. An admin credential leak could allow rapid mass unfreezing.

**Impact:** Low — requires admin credentials. But financial endpoints should have stricter per-operation limits.  
**Fix:** Add a financial-grade rate limit (e.g., 10/min) to the reactivate endpoint.

---

### L-7. SSE `ping` interval creates timers that may outlive the connection

**File:** `backend/routes/realtimeRoutes.ts` L106–L110  

The SSE keepalive ping is set up with `setInterval`, and cleanup is registered on multiple events. If cleanup logic fails to fire (e.g., edge case in Node.js HTTP/2), the interval leaks.

```ts
ping = setInterval(() => {
  if (!writeSse(res, { event: 'ping', data: { ts: new Date().toISOString() } })) {
    cleanup();
  }
}, 25_000);
```

**Impact:** Minor timer leak if cleanup doesn't execute. Mitigated by the `writeSse` failure check inside the interval.  
**Fix:** The current pattern is reasonable; consider adding a max-lifetime timeout for SSE connections as additional safety.

---

### L-8. `refreshSchema` accepts tokens up to 5000 chars

**File:** `backend/validations/auth.ts` L80–L82  

```ts
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(5000),
});
```

JWTs for this system are unlikely to exceed ~1000 chars. The 5000-char limit is unnecessarily generous.

**Impact:** Allows submission of large payloads in the token field, wasting parse/verify resources.  
**Fix:** Reduce to `max(2000)` or a more realistic limit.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 8 |
| Medium | 12 |
| Low | 8 |
| **Total** | **33** |

### Top Priority Fixes (ordered by risk × effort):

1. **C-1**: Add auth to `getOrderProofPublic` or remove it — 5 min fix, eliminates data leak
2. **C-4**: Make payout idempotency key deterministic — 5 min fix, prevents double payouts
3. **C-2**: Wrap settlement order.save() in the transaction — 30 min refactor
4. **C-3**: Add `ensureWallet(buyerUserId)` in unsettlement — 1 line fix
5. **H-1**: Scope `ownerOrPrivileged` to check network lineage — 30 min fix
6. **C-5**: Resolve DNS before fetch in image proxy — 1 hour refactor with proper SSRF library
7. **H-6**: Add scope filtering to `getTransactions` — 30 min fix
8. **M-4**: Add ObjectId regex to all validation schemas — 15 min bulk fix
