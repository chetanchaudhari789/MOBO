# Backend Audit Report — MOBO / Buzzma

> Generated from a full read of every backend file.  
> Stack: **Node.js · Express · TypeScript · MongoDB/Mongoose · Zod**

---

## 1. Complete File Inventory

### Config (2 files)
| File | Purpose |
|------|---------|
| `config/env.ts` | Zod-validated env schema. Enforces JWT secret length, real MongoDB URI, explicit CORS in prod. |
| `config/dotenvLoader.ts` | Loads `.env` from backend dir or repo root; handles `dist/` paths. |

### Entry points (2 files)
| File | Purpose |
|------|---------|
| `app.ts` | Express app factory — Helmet, CORS, rate-limiting, request-id, route mounting. |
| `index.ts` | Starts server; connects to MongoDB; graceful shutdown on SIGTERM/SIGINT. |

### Middleware (2 files)
| File | Purpose |
|------|---------|
| `middleware/auth.ts` | Zero-trust auth: fetches user from DB on every request. Cascade-checks upstream suspension (mediator→agency). Exports `requireAuth`, `optionalAuth`, `requireRoles`, `requireAuthOrToken`. |
| `middleware/errors.ts` | `AppError` class, Zod→400, CastError→400, malformed JSON→400, entity-too-large→413, catch-all→500 (message hidden in prod). All responses include `requestId`. |

### Models (17 files)
| File | Purpose |
|------|---------|
| `models/User.ts` | Core identity. Roles array, soft-delete, mobile normalization, KYC, bank details, brute-force lockout (7 attempts / 15 min), Google OAuth tokens, wallet balance cache. Unique partial indexes on mobile, email, mediatorCode, brandCode. |
| `models/Wallet.ts` | Per-user wallet: `availablePaise`, `pendingPaise`, `lockedPaise`, `version` for optimistic concurrency. Unique partial on `ownerUserId`. |
| `models/Transaction.ts` | Ledger entry: 15 types (brand_deposit, commission_settle, cashback_settle, …). Idempotency key (unique partial). Links to order/campaign/payout/wallet/users. |
| `models/Order.ts` | Core order: items array with campaign/deal refs, `workflowStatus` state machine, `frozen` flag, screenshots, AI verification results, rejection tracking, step-level verification, events log. Anti-fraud unique index on (userId, items.0.productId). |
| `models/Campaign.ts` | Brand campaigns: assignments Map (code→{limit, payout?, commissionPaise?}), `locked` flag, `allowedAgencyCodes`, `dealType`. |
| `models/Deal.ts` | Mediator-published deal snapshot from campaign. Unique partial on (campaignId, mediatorCode). |
| `models/Invite.ts` | Multi-use invites: useCount/maxUses, TTL auto-delete (30 days), full usage log. |
| `models/Agency.ts` | Agency profile document. |
| `models/Brand.ts` | Brand profile document. |
| `models/MediatorProfile.ts` | Mediator profile document. |
| `models/ShopperProfile.ts` | Shopper profile document. |
| `models/AuditLog.ts` | TTL index auto-purges at 180 days. Compound indexes for filtered queries. |
| `models/Payout.ts` | Payout tracking: provider/providerRef, unique partial index. |
| `models/Ticket.ts` | Support ticket model. |
| `models/Suspension.ts` | Suspension record model. |
| `models/SystemConfig.ts` | Key-value system config. |
| `models/PushSubscription.ts` | Web Push subscription storage. |

### Services (15 files)
| File | Purpose |
|------|---------|
| `services/aiService.ts` (3069 lines) | Gemini AI integration with model fallbacks, OCR worker pool, prompt-injection detection, rate-limiting, chat/proof/rating/return-window verification. |
| `services/audit.ts` | Writes MongoDB audit logs. Never breaks business flows (catches silently). |
| `services/authz.ts` | `getRequester()`, `isPrivileged()`, `requireAnyRole()`, `requireSelfOrPrivileged()`. |
| `services/codes.ts` | `generateHumanCode()` using `crypto.randomBytes`. |
| `services/invites.ts` | Atomic `consumeInvite()` with aggregation pipeline for concurrent use. Enforces upstream lineage checks. |
| `services/lineage.ts` | `listMediatorCodesForAgency()`, `getAgencyCodeForMediatorCode()`, `isAgencyActive()`, `isMediatorActive()`. |
| `services/orderEvents.ts` | Order event types and `pushOrderEvent()` helper. Defines terminal statuses. |
| `services/orderWorkflow.ts` | Explicit state machine with transition map. Uses `findOneAndUpdate` with workflow guard. `freezeOrders()` for bulk freeze; `reactivateOrder()`. |
| `services/passwords.ts` | bcrypt with 12 rounds + SHA-256 pre-hash for passwords >72 bytes. |
| `services/pushNotifications.ts` | Web Push (VAPID). Auto-removes invalid subscriptions (404/410). |
| `services/realtimeHub.ts` | EventEmitter SSE pub/sub with audience targeting. Max 500 listeners. |
| `services/roleDocuments.ts` | Upserts Agency/Brand/MediatorProfile/ShopperProfile documents. |
| `services/sheetsService.ts` | Google Sheets export via REST (no googleapis package). JWT + user OAuth refresh. |
| `services/tokens.ts` | JWT sign for access (default 15 min) and refresh (default 30 days). |
| `services/walletService.ts` | `ensureWallet()` with E11000 race handling. `applyWalletCredit()` / `applyWalletDebit()` with idempotency keys, MongoDB transactions, balance-limit checks, atomic `findOneAndUpdate`. |

### Controllers (10 files)
| File | Purpose |
|------|---------|
| `controllers/authController.ts` (716 lines) | Register (shopper via invite/mediator-code), login (mobile/username), refresh, registerOps, registerBrand, updateProfile. |
| `controllers/ordersController.ts` (912 lines) | `createOrder` (anti-fraud velocity checks), `submitClaim` (AI verification), `getUserOrders`, `getOrderProof`. |
| `controllers/opsController.ts` (2405 lines) | Full ops portal: mediator/buyer CRUD, verify/reject/settle/unsettle orders, create/assign/publish campaigns+deals, payouts. |
| `controllers/adminController.ts` (~800 lines) | Admin CRUD: users/orders/deals/wallets, suspension cascading, audit logs, stats, system config. |
| `controllers/brandController.ts` (753 lines) | Brand portal: agencies, campaigns CRUD, orders (PII-redacted), payouts, connections. |
| `controllers/inviteController.ts` (254 lines) | Admin/ops invite CRUD, agency generate mediator invite, mediator generate buyer invite. |
| `controllers/notificationsController.ts` (243 lines) | Computed notifications list for shopper + mediator UIs. |
| `controllers/productsController.ts` | `listProducts` (buyer sees own mediator's deals), `trackRedirect` (creates REDIRECTED pre-order). |
| `controllers/pushNotificationsController.ts` | VAPID public key, subscribe/unsubscribe endpoints. |
| `controllers/ticketsController.ts` (343 lines) | CRUD support tickets with scoped access per role. |

### Routes (14 files)
| File | Auth | Rate-limit | Notes |
|------|------|-----------|-------|
| `routes/authRoutes.ts` | Public (register/login/refresh), Auth (me/profile) | 60/15min prod (per identity+ip) | `Cache-Control: no-store` |
| `routes/ordersRoutes.ts` | Auth | 30/min (writes) | `ownerOrPrivileged` middleware |
| `routes/opsRoutes.ts` | Auth + agency/mediator/ops/admin | 1200/15min | — |
| `routes/adminRoutes.ts` | Auth + admin only | 900/15min | ObjectId validation + X-Confirm-Delete |
| `routes/brandRoutes.ts` | Auth + brand/admin/ops | 300/15min; 10/min financial | — |
| `routes/productsRoutes.ts` | Auth + shopper | Global only | — |
| `routes/aiRoutes.ts` | Mixed (auth + optional) | Per-endpoint configurable | — |
| `routes/healthRoutes.ts` | None | Global only | DB health + E2E seed check |
| `routes/realtimeRoutes.ts` | Auth (SSE stream) | Global only | — |
| `routes/notificationsRoutes.ts` | Auth | Global only | — |
| `routes/ticketsRoutes.ts` | Auth | Global only | — |
| `routes/sheetsRoutes.ts` | Auth | Global only | Google Sheets export |
| `routes/googleRoutes.ts` | Auth (initiate), None (callback) | Global only | OAuth 2.0 PKCE flow |
| `routes/mediaRoutes.ts` | Auth | Global only | Media upload/serve |

### Validations (9 files)
| File | Schemas |
|------|---------|
| `validations/auth.ts` | `registerSchema`, `loginSchema`, `registerOpsSchema`, `registerBrandSchema`, `updateProfileSchema`, `refreshSchema`. Strong password enforced. |
| `validations/orders.ts` | `createOrderSchema`, `submitClaimSchema`. Image data URL + HTTPS URL validation. |
| `validations/ops.ts` | 14+ schemas for all ops operations. |
| `validations/admin.ts` | Admin CRUD schemas. |
| `validations/brand.ts` | Brand campaign/connection schemas. |
| `validations/invites.ts` | Create/revoke invite schemas. |
| `validations/tickets.ts` | Create/update ticket schemas. |
| `validations/connections.ts` | Brand↔agency connection schemas. |
| `validations/systemConfig.ts` | System config patch schema. |

### Utils (4 files)
| File | Purpose |
|------|---------|
| `utils/mediatorCode.ts` | Normalize + case-insensitive regex builder. |
| `utils/mobiles.ts` | Normalize to 10-digit Indian mobile. |
| `utils/money.ts` | `rupeesToPaise()` / `paiseToRupees()` with `Math.round`. |
| `utils/uiMappers.ts` (430 lines) | Maps DB documents → UI-safe JSON. Converts paise→rupees. Redacts PII for brands. |

### Other backend files
| File | Purpose |
|------|---------|
| `index.e2e.ts` | E2E test setup. |
| `vitest.config.ts` | Unit test configuration. |
| `tsconfig.json` / `tsconfig.build.json` | TypeScript configs. |
| `package.json` | Dependencies. |
| `eslint.config.js` | Linting rules. |
| `eng.traineddata` | Tesseract OCR trained data. |
| `database/` | MongoDB connection setup. |
| `seeds/` | Seed scripts. |
| `scripts/` | Utility scripts. |
| `tests/` | Test files. |
| `types/` | TypeScript type declarations. |

---

## 2. Bugs, Missing Error Handling & Edge Cases

### 2.1 Critical Bugs

| # | Location | Issue |
|---|----------|-------|
| B1 | `opsController.ts` — `unsettleOrderPayment` | **Workflow reset bypasses state machine**. Directly sets `workflowStatus = 'APPROVED'` instead of using `transitionOrderWorkflow()`. This means the transition guard (`findOneAndUpdate` with `from` check) is skipped. If a concurrent settle is in progress, the direct assignment can corrupt state. Should use a forced-transition variant. |
| B2 | `ordersController.ts` — `createOrder` | **usedSlots incremented inside session, but pre-order upgrade also increments**. If the createOrder transaction rolls back after the `CampaignModel.updateOne({$inc: {usedSlots: 1}})`, the slot count won't roll back because the campaign update uses `.session(session)` correctly — however, the subsequent `transitionOrderWorkflow` calls happen **outside** the session. If those fail, you have a committed order + incremented slot but inconsistent workflow state. |
| B3 | `ordersController.ts` — `submitClaim` | **Response sent before async workflow transitions**. After `order.save()` in the `UNDER_REVIEW` early-return branch, the code sends `res.json()` then continues to publish realtime events. This is fine. But in the non-early-return path, `transitionOrderWorkflow` is called AFTER `res.json()` is NOT sent — the response is only sent after transitions complete, which is correct. However, the final `return;` after the realtime publish block means Express won't call `next()` — this is correct but could confuse if additional middleware is added. |
| B4 | `opsController.ts` — `rejectOrderProof` | **Campaign slot released on order proof rejection, but settlement may have occurred**. Line checks for `body.type === 'order'` and decrements `usedSlots`, but doesn't verify the order wasn't already settled. If an order goes: ORDERED→PROOF→REVIEW→APPROVED→REJECTED (admin manually), the slot is released but funds may have already moved. |

### 2.2 Missing Error Handling

| # | Location | Issue |
|---|----------|-------|
| E1 | `ordersController.ts` — `createOrder` | `session.endSession()` in `finally` — good. But `transitionOrderWorkflow` calls after the session (for initial proof auto-progression) are **not** wrapped in try/catch. If they throw, the response is never sent and the error propagates to the global handler, but the order is already committed. |
| E2 | `opsController.ts` — `settleOrderPayment` | After the settlement MongoDB session succeeds, the `order.save()` (to update paymentStatus/affiliateStatus) is outside the session. If this save fails, wallet mutations are committed but order status is stale. |
| E3 | `productsController.ts` — `trackRedirect` | No campaign slot check on redirect. A redirect creates a REDIRECTED pre-order even if the campaign is full. The slot check only happens at ORDERED status. Many redirects could give users a false impression of availability. |
| E4 | `authController.ts` — `refresh` | No refresh token rotation. The same refresh token can be reused indefinitely until it expires (30 days). Compromised tokens remain valid. |
| E5 | `inviteController.ts` — code generation | The retry loop runs 5 iterations to find a unique code. If all 5 collide (astronomically unlikely but possible), the duplicate code is used, causing an E11000 error that surfaces as an unhandled 500. |
| E6 | `googleRoutes.ts` | In-memory CSRF `pendingStates` map is lost on server restart. A user who starts OAuth, then the server restarts, will get a CSRF validation failure with no clear error message. |

### 2.3 Edge Cases

| # | Location | Issue |
|---|----------|-------|
| EC1 | `walletService.ts` | `ensureWallet` catches E11000 and retries with `findOne`. If MongoDB is in a bad state and both fail, the error propagates but the caller (settlement) may be mid-transaction. |
| EC2 | `orderWorkflow.ts` | `transitionOrderWorkflow` uses `findOneAndUpdate` with `workflowStatus: from` guard. If the document was already transitioned (e.g., concurrent request), it returns `null` and throws `TRANSITION_FAILED`. This is correct but means **every** caller must handle this error gracefully. `submitClaim` and `createOrder` do propagate it as a 409. |
| EC3 | `User.ts` model | Pre-validate hook normalizes mobile and deduplicates arrays. But `normalizeMobileTo10Digits` returns empty string for invalid inputs, which would pass the `required: true` check on the mobile field, then fail the regex validator. |
| EC4 | `opsController.ts` — `settleOrderPayment` | Buyer debit check happens, but if the buyer's wallet was just debited by another concurrent settlement, the second settlement could put the buyer wallet negative. The atomic `findOneAndUpdate` in `applyWalletDebit` guards against this for the brand debit, but **credit** to the buyer has no negative-balance risk. The risk is on the **brand debit** side, which is properly guarded. |

---

## 3. Missing Validations & Security Issues

### 3.1 Security Issues

| # | Severity | Issue |
|---|----------|-------|
| S1 | **HIGH** | **No refresh token rotation or blacklist.** A stolen refresh token grants 30-day access. Implement token rotation (new refresh token on each use) and a server-side blacklist. |
| S2 | **HIGH** | **No password reset flow.** There is no "forgot password" / email verification / OTP mechanism. Users locked out of their account have no self-service recovery path. |
| S3 | **MEDIUM** | **No CSRF protection on state-changing endpoints.** The API uses Bearer tokens (immune to traditional CSRF), but the Google OAuth callback is cookie-less, relying only on an in-memory state parameter — secure, but lost on restart. |
| S4 | **MEDIUM** | **Base64 image storage in MongoDB.** Proof screenshots are stored as base64 data URLs directly in the Order document. A 5MB image becomes ~6.7MB in base64. This inflates document size and MongoDB storage. Should use object storage (S3/R2) with signed URLs. |
| S5 | **MEDIUM** | **`avatar` and `qrCode` fields accept up to 5MB each** in `updateProfileSchema`. These are stored directly on the User document. A malicious user could inflate their profile document to 10MB+. |
| S6 | **MEDIUM** | **Rate-limit IP-based only with `trust proxy: 1`**. In shared-IP environments (corporate NATs, mobile carriers), legitimate users may hit limits. Per-user rate-limiting on authenticated endpoints would be better. |
| S7 | **LOW** | **Audit log TTL of 180 days** may be insufficient for financial compliance in India (typically 7-10 years for financial records). |
| S8 | **LOW** | **No 2FA / MFA.** Financial operations (settlements, payouts) have no second factor. |
| S9 | **LOW** | **Email field not verified.** Registration accepts email but never sends a verification link. Unverified emails could be used for phishing if any email notifications are added later. |

### 3.2 Missing Validations

| # | Location | Issue |
|---|----------|-------|
| V1 | `createOrderSchema` | `priceAtPurchase` allows 0 via `.nonnegative()`. A zero-price order would pass validation. Should be `.positive()`. |
| V2 | `createOrderSchema` | `commission` allows 0 (`.nonnegative()`). While intentional (free deals), no max bound — a massive commission could be injected. |
| V3 | `updateProfileSchema` | No phone number change restriction. Users can change their name freely but phone normalization may differ. |
| V4 | `ordersController.ts` | `externalOrderId` max length 128 allows very long IDs. No format validation (could contain script tags or SQL-like strings). While not directly rendered server-side, it's sent to UI. |
| V5 | `opsController.ts` — `settleOrderPayment` | No re-entrancy guard. If two admins click "settle" simultaneously, the first succeeds; the second fails at the workflow transition (APPROVED→REWARD_PENDING) because the state already changed. This is **correctly handled** by the state machine, but the wallet mutations are inside a separate session — the idempotency key prevents double-credit, so this is actually safe. Minor: the error message could be clearer. |
| V6 | `aiRoutes.ts` | AI chat endpoint accepts up to 200 products and 200 orders in the request body. These are passed to the AI prompt. Large payloads could cause high Gemini token costs. |

---

## 4. Production Readiness Improvements

### 4.1 Critical — Must Fix Before Launch

| # | Issue | Recommendation |
|---|-------|----------------|
| P1 | **In-memory SSE (realtimeHub)** | Uses `EventEmitter` — won't work across multiple server instances. Replace with Redis Pub/Sub or a managed message broker (e.g., BullMQ, Ably). |
| P2 | **In-memory Google OAuth state** | `pendingStates` Map lost on restart/deploy. Use Redis or a short-TTL MongoDB collection. |
| P3 | **No background job system** | Settlement cooling periods, scheduled tasks, retry logic all depend on synchronous request handling. Add a job queue (BullMQ/Agenda) for: settlement cooldown timers, failed push notification retries, stale order cleanup, scheduled reports. |
| P4 | **Base64 images in MongoDB** | Proof images stored inline grow documents to multi-MB. Use S3/R2 + signed URLs. This also impacts query performance when projecting orders. |
| P5 | **Missing password reset** | No user self-service recovery. Implement OTP-based or email-link-based reset. |

### 4.2 High Priority — Should Fix Soon

| # | Issue | Recommendation |
|---|-------|----------------|
| P6 | **`.limit(5000)` on queries** | Multiple controllers fetch up to 5000 documents. At scale, these queries will become slow and memory-intensive. Implement cursor-based pagination consistently. |
| P7 | **No structured logging** | Uses `console.log`/`console.error`. Switch to a structured logger (pino/winston) with JSON output for log aggregation services. |
| P8 | **No APM / metrics** | No Prometheus metrics, no response time histograms, no error-rate dashboards. Add basic instrumentation. |
| P9 | **OCR worker pool hardcoded to 2** | `aiService.ts` creates a fixed pool of 2 Tesseract workers. Should be configurable via env and scale with available CPU. |
| P10 | **No webhook system** | Brands have no programmatic way to receive order status updates. A webhook system would reduce polling. |
| P11 | **No request payload sanitization** | While Zod validates structure, string fields are not sanitized for XSS. The API serves JSON (not HTML), so browser XSS is unlikely, but stored XSS risk exists if any field is ever rendered as HTML. |

### 4.3 Medium Priority — Nice to Have

| # | Issue | Recommendation |
|---|-------|----------------|
| P12 | **Refresh token rotation** | Implement token rotation + device tracking. |
| P13 | **Graceful degradation for AI** | If Gemini is down, proof verification fails. Allow manual-only verification as fallback with notification to ops. |
| P14 | **Wallet balance cache on User** | `walletBalancePaise` on User model has no clear sync mechanism. If wallet balance changes without updating the User cache, UI may show stale data. |
| P15 | **No email notifications** | The system has push notifications but no email. Email is important for password resets, settlement confirmations, and dispute communications. |
| P16 | **Database indexes** | Several query patterns (e.g., `OrderModel.find({ managerName, workflowStatus })`) may not have optimal compound indexes. Run `explain()` on common queries. |

---

## 5. Wallet & Transaction Safety Assessment

### What's Done Right ✓

- **Idempotency keys** on all wallet operations (`applyWalletCredit`/`applyWalletDebit`). Keys are scoped per-user (unique partial index on `(idempotencyKey, ownerUserId)`) — retries are safe.
- **MongoDB transactions** wrap all multi-wallet operations (settlement debits brand + credits buyer + credits mediator atomically).
- **Balance guard** on debit: `findOneAndUpdate` with `availablePaise: { $gte: amountPaise }` — atomic, no TOCTOU race.
- **Balance ceiling**: configurable max wallet balance (default ₹1,00,000) prevents accumulation.
- **Integer arithmetic** in paise — no floating-point rounding issues.
- **Unsettlement reversal** atomically reverses all wallet mutations in a transaction.
- **ensureWallet outside transactions**: wallet creation (upserts) happen before the transaction session starts, avoiding conflicts.
- **Optimistic concurrency** via Mongoose `__v` on Campaign (prevents slot double-assignment).

### Remaining Risks ⚠

| # | Risk | Severity | Details |
|---|------|----------|---------|
| W1 | **Settlement + order status not atomic** | Medium | Wallet mutations are in a Mongo transaction, but the subsequent `order.save()` (updating `paymentStatus`/`affiliateStatus`) and `transitionOrderWorkflow` calls are outside it. A crash between wallet commit and order save leaves funds moved but order still showing "pending". **Mitigation**: The idempotency key prevents double-move on retry, and the order can be manually corrected by an admin via `unsettleOrderPayment`. |
| W2 | **No scheduled reconciliation** | Medium | There's no cron/job that compares total wallet balances vs total transaction ledger. A discrepancy would go undetected until manually audited. |
| W3 | **Agency payout bypass** | Low | When an agency (not admin) calls `payoutMediator`, the code creates a Payout record but does **not** debit the agency's wallet — it's treated as a "record of external transfer". This is documented behavior but means the agency wallet balance doesn't reflect actual liabilities. |
| W4 | **walletBalancePaise cache** | Low | The `walletBalancePaise` field on the User model appears to be a read-convenience cache. If it drifts from the actual Wallet document, UI shows wrong data. |

### Verdict: **Wallet safety is SOLID for a v1 launch.** The core credit/debit path is properly atomic with idempotency. The main gap is the non-atomic order status update post-settlement and the lack of automated reconciliation.

---

## 6. Order Workflow State Machine Assessment

### State Machine Design

```
CREATED → REDIRECTED → ORDERED → PROOF_SUBMITTED → UNDER_REVIEW → APPROVED → REWARD_PENDING → COMPLETED
                                                                  ↘ REJECTED   ↘ FAILED (Cap_Exceeded)
```

Terminal states: `Approved_Settled`, `Cap_Exceeded`, `Frozen_Disputed`

### What's Done Right ✓

- **Explicit transition map** in `orderWorkflow.ts` — only allowed transitions succeed.
- **Optimistic concurrency**: `findOneAndUpdate` with `workflowStatus: from` guard prevents concurrent transitions.
- **Frozen flag**: Orders can be bulk-frozen (on suspension) and individually reactivated. All mutation endpoints check `order.frozen`.
- **Upstream suspension cascade**: Auth middleware blocks requests if mediator/agency is suspended. Verification/settlement endpoints double-check `isMediatorActive()` and `isAgencyActive()`.
- **Event log**: Every transition is recorded in `order.events` with timestamp, actor, and metadata.
- **Step-gated verification**: Rating/review proofs require purchase verification first. Return window requires rating verification.
- **Auto-finalization**: `finalizeApprovalIfReady()` auto-approves when all required steps are verified.
- **Deal-type awareness**: Required steps computed from deal type (Discount → order only; Review → order + review; Rating → order + rating/review + returnWindow).

### Remaining Risks ⚠

| # | Risk | Severity | Details |
|---|------|----------|---------|
| O1 | **Unsetle bypasses state machine** | Medium | `unsettleOrderPayment` directly sets `workflowStatus = 'APPROVED'` instead of using `transitionOrderWorkflow()`. This avoids the transition guard. |
| O2 | **No timeout/SLA on UNDER_REVIEW** | Medium | Orders can sit in UNDER_REVIEW indefinitely. There's no automated escalation or timeout to flag stale orders. |
| O3 | **REDIRECTED pre-orders never expire** | Low | A `trackRedirect` creates a REDIRECTED order that never gets cleaned up if the buyer never completes purchase. No TTL or cleanup job. |
| O4 | **No REJECTED→re-submit workflow** | Low | When proof is rejected, the rejection clears the proof and sets `affiliateStatus = 'Rejected'`. The buyer can re-submit, but the workflow stays at `UNDER_REVIEW` — it doesn't rewind. This is intentional (simpler) but means the state machine doesn't fully represent the re-submission cycle. |
| O5 | **Campaign slot not released on REDIRECTED timeout** | Low | If a pre-order is created at REDIRECTED but upgraded to ORDERED (which increments `usedSlots`), and then the order is later rejected, the slot is released. But if it stays REDIRECTED forever, the slot was never consumed — no issue. |

### Verdict: **State machine is WELL-DESIGNED for a marketplace v1.** The transition guard pattern is correct. Main gap is the unsettle bypass and lack of timeout/SLA enforcement.

---

## 7. Missing Features That Should Exist

### Must-Have for Production

| # | Feature | Rationale |
|---|---------|-----------|
| F1 | **Password reset / account recovery** | Zero self-service recovery currently. A locked-out user requires admin intervention. |
| F2 | **Email verification** | Email field exists but is never verified. Required for any email-based features. |
| F3 | **Background job processing** | No job queue for: cooling period timers, stale order cleanup, scheduled reports, retry logic. |
| F4 | **Object storage for images** | Base64 in MongoDB is not scalable. S3/R2 with signed URLs. |
| F5 | **Wallet reconciliation job** | Automated check: sum of credits - sum of debits = wallet balance, per user. |

### Should-Have for Scale

| # | Feature | Rationale |
|---|---------|-----------|
| F6 | **Pagination everywhere** | Most list endpoints use `.limit(2000-5000)`. Need cursor-based pagination. |
| F7 | **Webhook notifications** | Brands need programmatic order status updates without polling. |
| F8 | **2FA / MFA** | Financial operations should have a second authentication factor. |
| F9 | **Horizontal SSE scaling** | Redis pub/sub to replace in-memory EventEmitter. |
| F10 | **Search / filtering on list endpoints** | Most list endpoints return all records. Full-text search on orders, campaigns, users. |

### Nice-to-Have

| # | Feature | Rationale |
|---|---------|-----------|
| F11 | **Bulk operations** | Bulk approve/reject orders, bulk settle, bulk campaign assignment. |
| F12 | **Export to CSV/Excel** | Google Sheets integration exists but native CSV export would be simpler for many use cases. |
| F13 | **Notification preferences** | Users can't control which push notifications they receive. |
| F14 | **API versioning** | No `/v1/` prefix. Breaking changes would require careful coordination. |
| F15 | **Rate-limit per user (not just IP)** | Authenticated endpoints should rate-limit per user identity, not just IP. |
| F16 | **Soft-delete garbage collection** | Soft-deleted records accumulate forever. Need a periodic cleanup or archive job. |
| F17 | **Campaign scheduling** | No start/end dates on campaigns. Campaigns are manually activated/paused. |

---

## 8. Summary Scorecard

| Area | Rating | Notes |
|------|--------|-------|
| **Auth & Security** | 🟡 B+ | Zero-trust auth is excellent. Missing: password reset, token rotation, 2FA. |
| **Wallet Safety** | 🟢 A- | Idempotent, atomic, integer math. Gap: non-atomic post-settlement order update. |
| **State Machine** | 🟢 A- | Well-designed with guards. Gap: unsettle bypass, no SLA timeouts. |
| **Code Quality** | 🟢 A | Consistent patterns, Zod everywhere, comprehensive audit logging, good error handling. |
| **Scalability** | 🟡 B- | In-memory SSE, large query limits, base64 images, no job queue. |
| **Production Readiness** | 🟡 B | Solid for a beta/MVP. Needs P1-P5 fixes for production traffic. |
| **Test Coverage** | 🟡 B | E2E tests exist (comprehensive spec files). Unit test infrastructure present but coverage unknown. |

**Overall: This is a well-architected backend for its stage.** The critical financial paths (wallet, settlement) are properly guarded. The main risks are operational (scaling, background jobs, image storage) rather than correctness bugs.
