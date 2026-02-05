# BUZZMA / MOBO Backend — Production Security & Bug Audit

> **Scope**: Every file under `backend/` (controllers, routes, middleware, services, models, validations, utils, config, database) plus shared types.
>
> **Date**: 2025-07-14
>
> **Methodology**: Full static source-code review.

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 6     |
| HIGH     | 14    |
| MEDIUM   | 18    |
| LOW      | 12    |

---

## CRITICAL

### C-1. Open SSRF proxy — `/media/image`

**File**: `backend/routes/mediaRoutes.ts` lines 10–70
**Problem**: The endpoint accepts an arbitrary URL via `req.query.url`, fetches it with the server's network identity, and returns the body. It has **no authentication**, no allowlist, and permits `http:` in addition to `https:`. An attacker can:

- Scan and exfiltrate data from internal RFC-1918 IPs, cloud metadata endpoints (`http://169.254.169.254/...`), and localhost services.
- Probe the MongoDB port or any other internal service.
- Use the server as an open proxy to mask malicious traffic.

**Fix**:

1. Add `requireAuth(env)` or at least a signed-token check.
2. Block private/reserved IPs (`10.x`, `172.16–31.x`, `192.168.x`, `127.x`, `169.254.x`, `::1`, `fd00::/8`, link-local, etc.) by resolving the hostname **before** fetching and comparing against a deny list.
3. Consider an allowlist of known CDN/product-image domains.
4. Remove `http:` from `ALLOWED_PROTOCOLS` in production.

---

### C-2. Unauthenticated proof image access — `getOrderProofPublic`

**File**: `backend/controllers/ordersController.ts` lines 149–168; `backend/routes/ordersRoutes.ts` line 15
**Problem**: `GET /api/public/orders/:orderId/proof/:type` returns order proof screenshots (order, payment, review, rating) **without any authentication**. Order IDs are sequential-ish MongoDB ObjectIds and trivially guessable/enumerable. Proofs often contain:

- Full customer names, addresses, and phone numbers.
- Payment details (UPI IDs, card last-4, transaction refs).
- Product purchase history.

This constitutes a PII data exposure vulnerability.

**Fix**: Remove the public endpoint. Serve proofs only through authenticated routes with ownership/role checks. If a public link is required (e.g., for brand verification), use time-limited signed URLs.

---

### C-3. Session used outside transaction in `createOrder`

**File**: `backend/controllers/ordersController.ts` lines 196, 314–368
**Problem**: A Mongoose session is started at line ~196 (`const session = await mongoose.startSession()`), but the campaign query at line ~314 uses `.session(session)` **before** `session.withTransaction()` is called at line ~368. At this point the session has no active transaction, so:

- The read is NOT part of the transaction snapshot, breaking read-your-own-writes guarantees.
- Between the slot-availability check (line ~346) and the slot increment inside `withTransaction` (line ~387), another concurrent request can pass the same check — leading to **over-selling campaign slots**.

**Fix**: Move `campaign` lookup and all pre-order checks **inside** `session.withTransaction()`. Alternatively, start the session with `session.startTransaction()` before the first `.session(session)` call.

---

### C-4. Unbounded default `REQUEST_BODY_LIMIT` — 120 MB

**File**: `backend/config/env.ts` line 10
**Problem**: The Zod default is `'120mb'`. Although `.env` overrides it to `10mb`, any deployment that forgets to set the env var will accept 120 MB JSON payloads. Combined with `express.json()` buffering the entire body into memory, a single request can exhaust server RAM, and a few concurrent requests will cause an OOM crash.

**Fix**: Change the Zod default to `'10mb'` (or `'2mb'`). The Zod schema is the production safety net; it should be conservative.

---

### C-5. E2E bypass leaks into production

**File**: `backend/controllers/ordersController.ts` lines 229, 278–285
**Problem**: `allowE2eBypass` is `true` whenever `env.SEED_E2E` is set **OR** `env.NODE_ENV !== 'production'`. In staging/preview environments (where `NODE_ENV` is commonly `'staging'` or `'preview'`):

- External order IDs are auto-generated (`E2E-<timestamp>`), bypassing the mandatory proof validation guard.
- AI proof verification is skipped entirely (line ~284), so users can submit fraudulent orders with invalid proofs.

**Fix**: Change the condition to `env.SEED_E2E && env.NODE_ENV !== 'production'`. Never skip proof validation based on `NODE_ENV` alone.

---

### C-6. AI proof verification bypass in `createOrder` — false confidence accepted

**File**: `backend/controllers/ordersController.ts` lines 290–300
**Problem**: When Gemini IS configured, proof verification rejects the order only if `confidenceScore < 60`. However, the Gemini response is AI-generated and the confidence can be trivially spoofed by submitting a carefully crafted fake proof image (e.g., an edited screenshot showing the expected order ID and amount). The threshold of 60 is very low for a financial anti-fraud gate. Additionally, if Gemini returns an error response that silently falls into the catch-all `{ confidenceScore: 0 }` path inside `verifyProofWithAi`, the `createOrder` logic might still proceed (depending on the error shape) because the outer code doesn't check for error fields in the verification response.

**Fix**:

1. Raise the confidence threshold to at least 80.
2. Check for an explicit `error` or `discrepancyNote` field in the verification result.
3. Add a manual review queue for orders with `60 ≤ confidence < 90`.
4. Consider server-side OCR cross-check against the external order ID.

---

## HIGH

### H-1. In-memory `dailyUsage` and `lastCallAt` maps grow without bound

**File**: `backend/routes/aiRoutes.ts` lines 133–134
**Problem**: `dailyUsage` and `lastCallAt` are plain `Map`s that accumulate one entry per user per day. They are never pruned. On a production server running for weeks with thousands of users, this is a **memory leak** that will eventually OOM the process.

**Fix**: Add a periodic cleanup (e.g., `setInterval` every 10 minutes) that evicts entries with a stale `day` or `lastCallAt` older than the minimum interval window.

---

### H-2. `optionalAuth` duplicates `resolveAuthFromToken` logic

**File**: `backend/middleware/auth.ts` lines 167–247
**Problem**: The `optionalAuth` middleware copy-pastes the full zero-trust + upstream suspension logic from `resolveAuthFromToken` instead of calling it. If the upstream suspension rules are ever updated in `resolveAuthFromToken`, `optionalAuth` will silently diverge, creating a bypass vector (e.g., AI routes using `optionalAuth` would not enforce the new rule).

**Fix**: Refactor `optionalAuth` to call `resolveAuthFromToken(token, env)` and catch its errors, exactly like `requireAuth` does.

---

### H-3. `requireAuthOrToken` accepts tokens from query strings

**File**: `backend/middleware/auth.ts` lines 130–143
**Problem**: The middleware reads JWT tokens from `req.query.access_token` and `req.query.token`. Query-string tokens are:

- Logged in web server access logs, proxy logs, CDN logs, and referrer headers.
- Cached by browsers and shared in copy-pasted URLs.

**Fix**: Deprecate query-string token support in production. If it is required for SSE, use a short-lived single-use ticket/nonce exchanged server-side.

---

### H-4. No `Content-Disposition` / `X-Content-Type-Options` on proof images

**File**: `backend/controllers/ordersController.ts` lines 105–137 (`sendProofResponse`)
**Problem**: `sendProofResponse` sets `Content-Type: image/*` and sends raw base64-decoded image data. It does not set:

- `Content-Disposition: inline` or `attachment` — the browser may interpret content in unexpected ways.
- `X-Content-Type-Options: nosniff` — the browser may MIME-sniff the response as HTML, enabling stored XSS via a malicious SVG or polyglot image.

**Fix**: Always set `Content-Disposition: inline; filename="proof.jpg"` and `X-Content-Type-Options: nosniff` on proof responses. Reject or sanitize SVG uploads entirely (SVGs can contain JavaScript).

---

### H-5. No input size validation on screenshots beyond `REQUEST_BODY_LIMIT`

**File**: `backend/validations/orders.ts`; `backend/controllers/ordersController.ts`
**Problem**: The `createOrderSchema` validates that `screenshots.order` is a data URL but does not cap its length. The `assertProofImageSize` function (controller lines ~80–100) checks size between 10 KB and 50 MB, but a 50 MB base64 string in a JSON payload means the entire request body can be ~67 MB (base64 overhead). The `updateProfileSchema` allows `avatar` up to 5 MB — also very large for a single field.

**Fix**: Tighten `assertProofImageSize` max to ~5 MB. Reduce `avatar` to ~500 KB. Use multipart form uploads + streaming to avoid buffering the full image in memory.

---

### H-6. Wallet credit/debit has no upper-bound check

**File**: `backend/services/walletService.ts` lines 40–80 (`applyWalletCredit`), lines 90–140 (`applyWalletDebit`)
**Problem**: There is no maximum amount check for credits or debits. A bug in the caller (or an admin typo) could credit a wallet with billions of paise. Wallets use `Number` type, which loses integer precision above `Number.MAX_SAFE_INTEGER` (~90 trillion paise / ~900 billion INR).

**Fix**: Add a `MAX_TRANSACTION_AMOUNT_PAISE` constant (e.g., 100_000_00 = ₹1,00,000) and reject transactions exceeding it. Use Mongoose `Decimal128` or `Long` if balances may exceed safe integer range.

---

### H-7. Order proof served as inferred MIME type

**File**: `backend/controllers/ordersController.ts` lines 105–137
**Problem**: `sendProofResponse` infers the Content-Type from the data URL prefix. If an attacker uploads a proof with a `data:text/html;base64,...` prefix, the server will serve it as `text/html`, enabling stored XSS.

**Fix**: Only allow `image/png`, `image/jpeg`, `image/webp` MIME types. Reject or re-encode anything else.

---

### H-8. `getTransactions` exposes raw Transaction documents

**File**: `backend/controllers/opsController.ts` (search for `getTransactions`)
**Problem**: The endpoint returns `Transaction` documents from MongoDB with `.lean()` without mapping them through a UI sanitizer. This leaks internal fields (`__v`, `deletedAt`, `deletedBy`, etc.) and potentially sensitive wallet/user linkage data.

**Fix**: Map results through a `toUiTransaction()` sanitizer like other endpoints do.

---

### H-9. Missing CSRF protection

**File**: `backend/app.ts`
**Problem**: The app uses cookie-less JWT auth, which is naturally CSRF-resistant. However, `cors({ credentials: true })` is enabled (line ~153), which tells browsers to send cookies with cross-origin requests. If any future feature adds cookie-based state (sessions, CSRF tokens), the current CORS config will not protect against CSRF.

**Fix**: Either remove `credentials: true` (since JWT is header-based) or add an explicit CSRF token mechanism.

---

### H-10. `toUiOrderForBrand` leaks `screenshots` and `reviewLink`

**File**: `backend/utils/uiMappers.ts` lines 245–324
**Problem**: The brand-facing order mapper explicitly strips `userId`, `buyerName`, and `buyerMobile` (good), but still includes `screenshots` (which contain base64-encoded proof images) and `reviewLink`. Proof images often contain buyer PII. The function's own doc comment says: "Brand must never receive buyer PII or raw proof artifacts."

**Fix**: Remove `screenshots` and `reviewLink` from `toUiOrderForBrand`. If brands need to see proof status, return only boolean flags like `hasOrderProof: true`.

---

### H-11. Suspension cascade does not revoke active JWT tokens

**File**: `backend/controllers/adminController.ts` (suspend user logic); `backend/middleware/auth.ts`
**Problem**: When an admin suspends a user, orders are frozen and deals deactivated, but existing JWT access tokens remain valid for up to 15 minutes (default `JWT_EXPIRES_IN`). During this window, the suspended user can continue making API calls. The zero-trust DB lookup in `resolveAuthFromToken` catches the `status !== 'active'` case, but refresh tokens (30-day default) stored client-side remain valid. If the user's status is later set back to `active` (e.g., by mistake), the old refresh token can be used.

**Fix**: Maintain a token revocation list (e.g., Redis set of revoked `jti` claims) or reduce access token TTL to ≤5 minutes. For refresh tokens, add a `tokenVersion` field on the User model and increment it on suspension.

---

### H-12. No pagination on `getUserOrders` — 2000-doc scan

**File**: `backend/controllers/ordersController.ts` lines 171–190
**Problem**: `getUserOrders` fetches up to 2000 orders per request with no cursor/pagination. For active buyers, this returns a massive JSON payload, consuming server memory and bandwidth.

**Fix**: Add cursor-based pagination (`?after=<lastId>&limit=50`). Default limit to 50, max 200.

---

### H-13. `setMaxListeners(0)` removes EventEmitter leak protection

**File**: `backend/services/realtimeHub.ts`
**Problem**: `setMaxListeners(0)` disables Node's built-in memory leak detection for EventEmitter. If SSE connections are not properly cleaned up (e.g., due to a bug in `cleanup()` or a zombie connection), listeners accumulate silently with no warning.

**Fix**: Set a reasonable max (e.g., 5000) and log a warning if exceeded, rather than disabling the check entirely.

---

### H-14. Brand payout `amount` is in INR but validated only as `positive()`

**File**: `backend/validations/brand.ts` line 7; `backend/controllers/brandController.ts`
**Problem**: `payoutAgencySchema` validates `amount: z.coerce.number().positive()` with no upper bound. A brand user could submit `amount: 999999999` and drain their wallet (or cause integer overflow in paise conversion). The `rupeesToPaise()` utility uses `Math.round(rupees * 100)` which can lose precision for very large numbers.

**Fix**: Add `.max(10_000_000)` (₹1 crore) or a configurable limit. Validate that the wallet has sufficient balance before initiating the transfer.

---

## MEDIUM

### M-1. `generateHumanCode` retries only 5 times

**File**: `backend/controllers/inviteController.ts`; `backend/services/codes.ts`
**Problem**: The human-readable code generator retries up to 5 times on collision. With a large number of invites, collisions become frequent and the function throws after 5 failed attempts, returning a 500 to the user.

**Fix**: Increase retries to 20. Alternatively, append a random suffix on collision.

---

### M-2. `brandController.getTransactions` swallows errors

**File**: `backend/controllers/brandController.ts` (search for `getTransactions`)
**Problem**: The `catch` block returns `res.json([])` instead of propagating the error. This silently hides database failures, making debugging very difficult.

**Fix**: Log the error and return a 500 status with an appropriate error payload.

---

### M-3. No `secure`, `httpOnly`, `SameSite` cookie flags

**File**: `backend/controllers/authController.ts`
**Problem**: If the refresh token is ever stored in a cookie (some frontend implementations do this), the backend does not set `Secure`, `HttpOnly`, or `SameSite` attributes. Currently tokens are returned in JSON response bodies, but the `credentials: true` CORS setting suggests cookie support may be intended.

**Fix**: If cookies are used, always set `{ httpOnly: true, secure: true, sameSite: 'strict' }`.

---

### M-4. `mediatorCode` collision retry in registration

**File**: `backend/controllers/authController.ts` lines ~170–200
**Problem**: During ops/mediator registration, the mediator code is generated and checked for uniqueness with up to 5 retries. The check and the save are not atomic — between the uniqueness check and the `User.save()`, another concurrent registration could claim the same code.

**Fix**: Rely on the unique index on `mediatorCode` to reject duplicates, catch `E11000`, and retry with a new code.

---

### M-5. `isImageDataUrl` allows SVGs

**File**: `backend/validations/orders.ts` lines 19–22
**Problem**: The regex allows `svg+xml` MIME types for proof images. SVGs can contain embedded JavaScript, which is an XSS vector if the proof is ever rendered in a browser (e.g., via the proof endpoint).

**Fix**: Remove `svg\+xml` from the allowed image types. Only allow `png`, `jpeg`, `webp`.

---

### M-6. No rate limiting on `/api/public/orders/:orderId/proof/:type`

**File**: `backend/routes/ordersRoutes.ts` line 15
**Problem**: The unauthenticated proof endpoint has no rate limiting at all (only the global 300/min applies). An attacker can enumerate order IDs at high speed.

**Fix**: Add a strict rate limit (e.g., 10/min per IP). Better yet, remove the public endpoint entirely (see C-2).

---

### M-7. `toUiUser` leaks `kycDocuments` to all callers

**File**: `backend/utils/uiMappers.ts` lines 22–70
**Problem**: `toUiUser` includes `kycDocuments` (which may contain sensitive identity documents) in every response. Not all callers need this data.

**Fix**: Only include `kycDocuments` when the requester is the user themselves or an admin.

---

### M-8. Campaign query before slot check is not transactionally isolated

**File**: `backend/controllers/ordersController.ts` lines 314–366
**Problem**: The campaign availability check (status, slot count, mediator slot count) happens **outside** the transaction. Two concurrent buyers can both see 1 slot remaining, both pass the check, and both increment `usedSlots` inside the transaction — resulting in `usedSlots > totalSlots`.

**Fix**: Move all campaign checks inside `session.withTransaction()` and use the session for all reads.

---

### M-9. Error detail leakage in AI service

**File**: `backend/services/aiService.ts` lines 445, 555
**Problem**: On Gemini failure, the catch block returns: `discrepancyNote: \`AI verification failed: \${error.message}\`` — which may contain Gemini API key prefixes, internal URLs, or stack details.

**Fix**: Use `sanitizeAiError(error)` (already defined at line 79) instead of raw `error.message`.

---

### M-10. `DELETE /api/admin/users/:userId/wallet` has no confirmation

**File**: `backend/controllers/adminController.ts`
**Problem**: Admin can permanently delete a user's wallet (and all transactions) with a single DELETE request. There is no confirmation step, soft-delete period, or "wallet has non-zero balance" safety check.

**Fix**: Reject deletion if `availablePaise > 0` or `pendingPaise > 0`. Require a confirmation header (e.g., `X-Confirm-Delete: true`).

---

### M-11. No audit log for proof image access

**File**: `backend/controllers/ordersController.ts`
**Problem**: Neither `getOrderProof` (authenticated) nor `getOrderProofPublic` emit an audit event. Given that proofs contain PII, access should be logged for compliance.

**Fix**: Call `logAudit()` with `action: 'order.proof.accessed'`.

---

### M-12. `toUiOrder` leaks `buyerMobile` to ops/mediator/agency

**File**: `backend/utils/uiMappers.ts` line 218
**Problem**: `toUiOrder` includes `buyerMobile` in every response. Mediators and agencies should not have access to buyer phone numbers.

**Fix**: Only include `buyerMobile` if the requester is the buyer or an admin.

---

### M-13. No expiry cleanup for SSE keepalive intervals

**File**: `backend/routes/realtimeRoutes.ts` lines 150–158
**Problem**: If `cleanup()` throws before `clearInterval(ping)`, the interval continues ticking forever, leaking resources. Although `cleaned` flag guards re-entry, the `try/catch` pattern means an exception in `clearInterval` (unlikely but possible in exotic runtimes) would skip `unsubscribe()`.

**Fix**: Wrap each cleanup step independently (already partially done, but ensure `unsubscribe` is called even if `clearInterval` throws).

---

### M-14. `trust proxy` set to `1` — not verified

**File**: `backend/app.ts` line 91
**Problem**: `app.set('trust proxy', 1)` trusts exactly one hop. If the deployment is behind multiple proxies (e.g., Cloudflare → NGINX → Express), `req.ip` will reflect an intermediate proxy IP rather than the client, making IP-based rate limiting ineffective.

**Fix**: Verify the deployment topology and set `trust proxy` accordingly. For Cloudflare, trust the `CF-Connecting-IP` header.

---

### M-15. Wallet operations do not validate `amountPaise` is an integer

**File**: `backend/services/walletService.ts` lines 40–80, 90–140
**Problem**: `amountPaise` is expected to be an integer (paise), but neither `applyWalletCredit` nor `applyWalletDebit` checks for `Number.isInteger(amountPaise)`. A caller passing `100.5` would corrupt the wallet balance.

**Fix**: Add `if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new AppError(400, ...)`.

---

### M-16. `unsettleOrder` reversal does not verify original settlement amounts

**File**: `backend/controllers/opsController.ts` (search for `unsettleOrder`)
**Problem**: When an order is unsettled, the system debits the buyer and credits the brand wallet with amounts calculated from the order at the time of unsettlement. If the order amounts were modified between settlement and unsettlement, the reversal amounts would be incorrect.

**Fix**: Store the exact settlement amounts in a `settlement` sub-document on the order and use those for reversal.

---

### M-17. No index on `Order.managerName` for mediator sales count

**File**: `backend/controllers/ordersController.ts` line ~350; `backend/models/Order.ts`
**Problem**: The mediator slot check runs `OrderModel.countDocuments({ managerName: upstreamMediatorCode, 'items.0.campaignId': campaign._id, ... })`. While there is a compound index on `(userId, ...)`, there is no index starting with `managerName`, causing a full collection scan on large order volumes.

**Fix**: Add index `{ managerName: 1, 'items.0.campaignId': 1, status: 1, deletedAt: 1 }`.

---

### M-18. Chat route sends user data to Gemini without consent notice

**File**: `backend/routes/aiRoutes.ts` (chat handler); `backend/services/aiService.ts`
**Problem**: The chat endpoint sends user names, order details, and ticket data to Google Gemini without explicit user consent. This may violate GDPR/privacy requirements.

**Fix**: Require explicit opt-in before sending PII to external AI providers. Anonymize data where possible.

---

## LOW

### L-1. `as any` casts throughout controllers

**Files**: Multiple (`ordersController.ts`, `opsController.ts`, `adminController.ts`, `brandController.ts`)
**Problem**: Heavy use of `as any` bypasses TypeScript's type system, hiding potential `undefined` access and type mismatches.

**Fix**: Define proper interfaces for Mongoose lean documents and use them instead of `as any`.

---

### L-2. `console.log` / `console.error` used instead of structured logger

**Files**: All controllers and services
**Problem**: Using `console.log`/`console.error` produces unstructured output that is difficult to filter, query, and alert on in production log aggregators.

**Fix**: Adopt a structured logger (pino, winston) with JSON output, log levels, and request-ID correlation.

---

### L-3. `password` field not excluded from user queries

**File**: `backend/controllers/authController.ts`; `backend/controllers/adminController.ts`
**Problem**: Several user queries use `.lean()` without explicitly excluding the `password` field. While `toUiUser` does not include `password` in its output, the raw document in memory contains the bcrypt hash, which is unnecessary.

**Fix**: Add `.select('-password')` to all user queries that don't need the password.

---

### L-4. `Invite.uses` sub-document array has no size limit

**File**: `backend/models/Invite.ts` lines 31–36
**Problem**: The `uses` array on an invite has no `maxItems` constraint. An invite with `maxUses: 10` could theoretically accumulate more than 10 entries if the atomic update races (though the `$inc` + `$lt` pipeline should prevent it).

**Fix**: Add a Mongoose `validate` hook to enforce `uses.length <= maxUses`.

---

### L-5. `normalizeMobileTo10Digits` does not handle `+91` prefix

**File**: `backend/utils/mobiles.ts` lines 13–20
**Problem**: If the user enters `+919876543210`, `digitsOnly()` strips the `+`, producing `919876543210` (12 digits, starts with `91`) — this is handled. But `+0919876543210` (with leading 0 after +) produces `0919876543210` (13 digits) which falls through to the default `return digits` — failing the 10-digit validation.

**Fix**: Add handling for 13-digit inputs starting with `091`.

---

### L-6. `rupeesToPaise` floating-point edge case

**File**: `backend/utils/money.ts` line 3
**Problem**: `Math.round(rupees * 100)` can produce incorrect results for certain floating-point values. For example, `rupeesToPaise(1.005)` returns `100` instead of `101` because `1.005 * 100 = 100.49999999999999` in IEEE 754.

**Fix**: Use `Math.round(Number((rupees * 100).toFixed(2)))` or operate on string representations.

---

### L-7. `toUiCampaign` status mapping is incomplete

**File**: `backend/utils/uiMappers.ts` lines 80–85
**Problem**: The status map only covers `active`, `paused`, `completed`, `draft`. If a campaign has any other status (e.g., `archived`), it silently maps to `'Draft'` via the `?? 'Draft'` fallback, which is misleading.

**Fix**: Log a warning for unmapped statuses.

---

### L-8. Realtime `shouldDeliver` does not check `mediatorCodes` / `agencyCodes`

**File**: `backend/routes/realtimeRoutes.ts` lines 28–36 (`shouldDeliver`)
**Problem**: The `shouldDeliver` function checks `broadcast`, `userIds`, and `roles`, but does not check `mediatorCodes`, `agencyCodes`, or `brandCodes`. These are checked separately in the SSE handler. This means the `shouldDeliver` abstraction is incomplete and cannot be reused.

**Fix**: Consolidate all audience checks into `shouldDeliver`.

---

### L-9. No graceful handling of MongoDB replica set failover in transactions

**File**: `backend/controllers/ordersController.ts`, `backend/controllers/authController.ts`
**Problem**: `session.withTransaction()` may throw `TransientTransactionError` during replica set elections. The code does not retry on this error class.

**Fix**: Wrap `session.withTransaction()` with a retry loop that checks for `TransientTransactionError` labels (MongoDB driver usually handles this, but explicit handling is safer).

---

### L-10. `DealModel.findById(item.productId)` may throw on invalid ObjectId

**File**: `backend/controllers/ordersController.ts` line ~363
**Problem**: If `item.productId` is not a valid ObjectId format (e.g., a slug or SKU), `findById()` throws a `CastError`. While the global error handler catches this, it returns a generic 400 instead of a clear message.

**Fix**: Validate `item.productId` as a valid ObjectId before the query, or use `findOne({ _id: ... })` with a try/catch.

---

### L-11. `extractOrderDetailsWithAi` creates RegExp objects inside the loop

**File**: `backend/services/aiService.ts` lines 560–620
**Problem**: Multiple `new RegExp(...)` calls with the same patterns are created every time `extractOrderDetailsWithAi` is called. These should be module-level constants for performance.

**Fix**: Move regex declarations to module scope.

---

### L-12. `healthy` variable in `mongo.ts` never gates requests

**File**: `backend/database/mongo.ts`
**Problem**: The `healthy` variable tracks MongoDB connection state but is never exposed or checked by request handlers. If MongoDB goes down mid-flight, requests will hang or throw with cryptic timeout errors instead of fast-failing with a 503.

**Fix**: Expose a `isDbHealthy()` function and check it in a middleware or health route.

---

## Appendix — Files Reviewed

| Directory              | Files                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/` root        | `app.ts`, `index.ts`, `index.e2e.ts`                                                                                                                                                                                                                                |
| `backend/config/`      | `env.ts`, `dotenvLoader.ts`                                                                                                                                                                                                                                         |
| `backend/database/`    | `mongo.ts`                                                                                                                                                                                                                                                          |
| `backend/middleware/`  | `auth.ts`, `errors.ts`                                                                                                                                                                                                                                              |
| `backend/controllers/` | `authController.ts`, `adminController.ts`, `ordersController.ts`, `brandController.ts`, `productsController.ts`, `opsController.ts`, `ticketsController.ts`, `notificationsController.ts`, `inviteController.ts`, `pushNotificationsController.ts`                  |
| `backend/routes/`      | `authRoutes.ts`, `adminRoutes.ts`, `opsRoutes.ts`, `ordersRoutes.ts`, `brandRoutes.ts`, `productsRoutes.ts`, `healthRoutes.ts`, `realtimeRoutes.ts`, `mediaRoutes.ts`, `aiRoutes.ts`, `ticketsRoutes.ts`, `notificationsRoutes.ts`                                  |
| `backend/services/`    | `walletService.ts`, `orderWorkflow.ts`, `orderEvents.ts`, `tokens.ts`, `passwords.ts`, `codes.ts`, `authz.ts`, `lineage.ts`, `audit.ts`, `invites.ts`, `realtimeHub.ts`, `pushNotifications.ts`, `roleDocuments.ts`, `aiService.ts`                                 |
| `backend/models/`      | `User.ts`, `Order.ts`, `Campaign.ts`, `Wallet.ts`, `Transaction.ts`, `Deal.ts`, `Invite.ts`, `Payout.ts`, `Ticket.ts`, `Agency.ts`, `Brand.ts`, `Suspension.ts`, `SystemConfig.ts`, `AuditLog.ts`, `MediatorProfile.ts`, `ShopperProfile.ts`, `PushSubscription.ts` |
| `backend/validations/` | `auth.ts`, `orders.ts`, `ops.ts`, `brand.ts`, `admin.ts`, `invites.ts`, `connections.ts`, `tickets.ts`, `systemConfig.ts`                                                                                                                                           |
| `backend/utils/`       | `money.ts`, `mobiles.ts`, `mediatorCode.ts`, `uiMappers.ts`                                                                                                                                                                                                         |
