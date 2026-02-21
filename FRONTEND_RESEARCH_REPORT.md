# Frontend Research Report

**Scope:** All 5 frontend apps (`admin-web`, `agency-web`, `brand-web`, `buyer-app`, `mediator-app`) + `shared/`  
**Date:** Research-only audit — no changes made.

---

## 1. Shared Services

### Service Files Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `shared/services/api.ts` | 1045 | Central fetch-based API client — auth, products, orders, chat, ops, brand, admin, tickets, ai, notifications, sheets, google namespaces |
| `shared/services/realtime.ts` | 304 | SSE-based realtime client with exponential backoff, auth retry, idle reconnect, cross-tab token sync |
| `shared/services/mockBackend.ts` | 713 | In-memory mock backend with localStorage persistence (`mobo_v7_` prefix), auto-settlement, receipt registry, fraud detection |
| `shared/services/mockData.ts` | 552 | Seed data generator — 15 brands, 4 agencies, 28 mediators, 150 shoppers, 40 campaigns, ~800 orders |

### API Client Architecture (`api.ts`)

- **Auth mechanism:** JWT Bearer tokens stored in localStorage under key `mobo_tokens_v1` (line 9). Auto-refreshes on 401 via `/auth/refresh` (lines 97–140).
- **Request IDs:** Every request gets a `X-Request-ID` header for traceability (line 166).
- **Timeouts:** 60s default with comment "Increased for AI endpoints that may take 15-45s" (line 183).
- **Mojibake fix:** `fixMojibake()` utility corrects INR symbol encoding issues (lines 23–36).
- **Image compression:** `compressImage()` resizes to max 1200px before AI upload (lines 310–350).
- **Error wrapping:** `wrapFetchError()` converts network/timeout errors to user-friendly messages (lines 187–205).
- **Auth expiry event:** `onAuthExpired` callback system forces logout across all consumers (lines 41–49).

### Realtime Client Architecture (`realtime.ts`)

- **Protocol:** Server-Sent Events (SSE) with `EventSource`.
- **Backoff:** Exponential with max 5 retries, 1s–16s range (lines 80–120).
- **Idle reconnect:** Reconnects after 70s of inactivity (line 142).
- **Cross-tab sync:** Listens for `storage` events to pick up token refreshes from other tabs (line 210).
- **Auth retry:** On 401 from SSE, attempts token refresh before reconnecting (lines 160–185).

### URL Resolution (`shared/utils/apiBaseUrl.ts`, 88 lines)

Resolution order:
1. `globalThis.__MOBO_API_URL__` (runtime injection)
2. `VITE_API_URL` env var
3. `NEXT_PUBLIC_API_URL` env var
4. Vite proxy (`/api`)
5. `http://localhost:8080/api` (dev fallback, line 72)
6. `/api` (relative)

### MongoDB / Mongoose References in Shared

**None found.** Grep for `mongoose|mongodb|ObjectId|Schema\(` across all of `shared/` returned zero results. The shared layer is cleanly decoupled from the database.

---

## 2. Error Handling in API Calls

### Centralized Error Utilities (`shared/utils/errors.ts`, 103 lines)

| Export | Purpose |
|--------|---------|
| `formatErrorMessage(err, fallback)` | Extracts user-friendly message from any error object |
| `classifyError(err)` | Returns category: `'network' \| 'timeout' \| 'auth' \| 'validation' \| 'server' \| 'unknown'` |
| `httpStatusToFriendlyMessage(status)` | Maps HTTP codes to human-readable strings |
| `isNetworkError(err)` | Checks for `TypeError: Failed to fetch` etc. |
| `isTimeoutError(err)` | Checks for `AbortError` or timeout-related messages |

### Pages Using `formatErrorMessage` (GOOD pattern)

| File | Lines |
|------|-------|
| `shared/pages/AdminPortal.tsx` | 461, 474, 494, 511, 527, 539, 557, 576, 587 (9 usages — most consistent) |
| `shared/pages/Orders.tsx` | 365, 384, 613, 713, 1718 |
| `shared/pages/MediatorDashboard.tsx` | 546, 857, 1045 |
| `shared/pages/BrandDashboard.tsx` | 2099 (only 1 usage) |
| `shared/pages/Profile.tsx` | 103, 148 |
| `shared/pages/Auth.tsx` | 94 |
| `shared/context/MediatorAuth.tsx` | 56, 91 |

### Pages Using Raw `err.message` (INCONSISTENT — exposes server error text to users)

| File | Lines | Pattern |
|------|-------|---------|
| **AgencyDashboard.tsx** | 1101, 1673, 1742, 1801, 1819, 2225, 2896, 2916 | `err instanceof Error ? err.message : 'fallback'` — **8 occurrences, never uses `formatErrorMessage`** |
| **MediatorDashboard.tsx** | 1255, 1266, 2443, 2502, 2533, 2627 | `err instanceof Error ? err.message : 'fallback'` — **6 occurrences** |
| **BrandDashboard.tsx** | 197, 1607, 2503 | `(e as any)?.message`, `err?.message` — **3 occurrences** |
| **Orders.tsx** | 688 | `String(e.message \|\| 'Failed to submit order.')` — **1 occurrence** |

### Summary of Error Handling Gaps

- **AgencyDashboard.tsx** is the worst offender — it imports zero error utilities and uses raw `err.message` in all 8 catch blocks. Server-side error strings (e.g., Prisma constraint violations, validation errors) can appear directly in toast notifications.
- **MediatorDashboard.tsx** mixes both patterns: uses `formatErrorMessage` in 3 places but raw `err.message` in 6 others.
- **BrandDashboard.tsx** imports `formatErrorMessage` but only uses it once (line 2099) out of ~15 catch blocks.
- **AdminPortal.tsx** is the gold standard — uses `formatErrorMessage` in all 9 catch blocks.

---

## 3. Security Issues

### 3.1 Token Storage in localStorage

| File | Line(s) | Key | Risk |
|------|---------|-----|------|
| `shared/services/api.ts` | 9, 55 | `mobo_tokens_v1` | JWT access + refresh tokens in localStorage. Vulnerable to XSS-based token theft. |
| `shared/context/AuthContext.tsx` | 56, 96, 115, 125, 133, 153, 160, 168 | `mobo_session` | Full user object stored in localStorage. |
| `shared/context/CartContext.tsx` | 62, 80 | `mobo_cart_{userId}` | Cart items per user. Low risk. |
| `shared/context/NotificationContext.tsx` | 150, 173 | `mobo_last_seen_*`, `mobo_dismissed_*` | Notification timestamps and dismissed IDs. Has pruning logic to prevent unbounded growth (line 163). Low risk. |
| `shared/services/mockBackend.ts` | 35+ | `mobo_v7_*` | Mock data persistence — dev only. |

**Recommendation:** For production with sensitive financial data, consider `httpOnly` cookie storage for refresh tokens to eliminate XSS token theft vector. Access token can remain in memory (not localStorage).

### 3.2 XSS Vectors

| File | Line | Usage | Risk |
|------|------|-------|------|
| `shared/layouts/MoboHead.tsx` | 21 | `dangerouslySetInnerHTML` | **LOW** — injects static CSS `:root` variables and global styles. Content is hardcoded, not user-generated. |

No other `dangerouslySetInnerHTML` usages found across the entire `shared/` directory.

**Chatbot.tsx FormattedText component** (line 69): Parses `**bold**` markdown manually and renders via `<strong>` tags. Uses `.split()` + `.map()` — does NOT use `dangerouslySetInnerHTML`. Safe.

### 3.3 CSRF Protection

- The app uses `Authorization: Bearer <token>` headers (not cookies) for authentication. This is **naturally CSRF-resistant** since browsers don't auto-attach custom headers on cross-origin requests.
- However, the backend has `cors({ credentials: true })` enabled (noted in existing `SECURITY_AUDIT.md`). If cookie-based auth is ever added, CSRF tokens would be needed.

### 3.4 Hardcoded URLs / Secrets

| File | Line | Value | Risk |
|------|------|-------|------|
| `shared/utils/apiBaseUrl.ts` | 72 | `http://localhost:8080/api` | Dev-only fallback; safe — only triggers when no env vars are set and running on localhost. |
| `shared/services/realtime.ts` | ~49 | `http://localhost:8080/api` | Same pattern — dev fallback. |
| All 5 `apps/*/next.config.js` | varies | `http://localhost:8080` | `NEXT_PUBLIC_API_PROXY_TARGET` fallback — dev only. |

**No hardcoded API keys, secrets, or OpenAI keys found** in any shared code. Grep for `secret|API_KEY|apiKey|OPENAI|GPT|sk-` returned zero results in `shared/`.

### 3.5 Input Sanitization

- **Chatbot text input:** Capped at 400 characters (line 313 of Chatbot.tsx: `.slice(0, 400)`).
- **File upload:** Capped at 10 MB (line 283 of Chatbot.tsx).
- **Context sent to AI:** Products truncated to 10 items, orders to 5, ticket descriptions to 120 chars, history to 6 messages × 300 chars (lines 400–430).
- **No HTML sanitization library** (e.g., DOMPurify) is used anywhere in the frontend. All text rendering uses React's default JSX escaping, which is safe for text content.

---

## 4. Missing Features for Backtracking / Audit

### 4.1 Current Audit Trail Implementation

**Shared utility:** `shared/utils/auditDisplay.ts` (48 lines)
- `filterAuditLogs()`: Filters to 8 visible actions: `ORDER_CREATED`, `PROOF_SUBMITTED`, `PROOF_VERIFIED`, `PROOF_REJECTED`, `ORDER_CANCELLED`, `SETTLEMENT_INITIATED`, `SETTLEMENT_COMPLETED`, `PAYOUT_COMPLETED`
- `auditActionLabel()`: Maps action enums to human-readable labels (e.g., `PROOF_SUBMITTED` → "Proof Submitted")
- Deduplicates consecutive entries with same action

**API endpoints:**
- `api.orders.getOrderAudit(orderId)` — per-order audit trail
- `api.admin.getAuditLogs(filters)` — system-wide audit logs (admin only)

### 4.2 Audit Trail by Dashboard

| Dashboard | Order-Level Audit | System-Level Audit | Wallet/Transaction History |
|-----------|------------------|-------------------|---------------------------|
| **AdminPortal.tsx** | Yes (in order detail modal) | Yes — dedicated `audit-logs` tab (line 75), fetches via `api.admin.getAuditLogs()` (lines 270–274) | N/A |
| **BrandDashboard.tsx** | Yes (in order detail, lines 588–1432) | **NO** — no brand-wide activity log | Has `getTransactions` API but display unclear |
| **AgencyDashboard.tsx** | Yes (in order detail, lines 2812–3680) | **NO** — no agency-wide activity log | Has `getAgencyLedger` API |
| **MediatorDashboard.tsx** | Yes (in order detail, lines 1578–2373) | **NO** — no mediator-wide activity log | **NO** — no wallet ledger view |
| **Orders.tsx (Buyer)** | Yes (in order detail, lines 215–1320) | N/A | **NO** — wallet balance shown but no transaction history page |

### 4.3 Specific Gaps

1. **Brand Dashboard** — No aggregate activity log showing all actions taken (product creates/edits, campaign changes, payout requests). Only per-order audit exists.
2. **Agency Dashboard** — No consolidated view of mediator assignments, inventory distributions, campaign changes. Only per-order audit in proof modals.
3. **Mediator Dashboard** — No activity log for verifications performed, settlements initiated, payouts received. Only per-order audit in detail view.
4. **Buyer App** — No wallet transaction history / ledger page. Balance is displayed but individual credit/debit entries are not browsable.
5. **Admin audit-logs tab** — Exists but only shows the 8 filtered action types. Actions like `USER_CREATED`, `PRODUCT_UPDATED`, `CAMPAIGN_MODIFIED`, `TICKET_RESOLVED` etc. are NOT surfaced (filtered out by `filterAuditLogs` in `auditDisplay.ts`).
6. **No export/download** — None of the dashboards offer CSV/PDF export of audit trails.
7. **No date-range filtering** — The admin audit-logs tab fetches logs but filtering controls are limited.

---

## 5. AI-Related Frontend Code

### 5.1 AI API Endpoints (in `api.ts`)

| Method | Endpoint | Lines | Purpose |
|--------|----------|-------|---------|
| `api.orders.extractDetails(image)` | `POST /ai/extract-order` | 456–463 | OCR: extracts order details from screenshot |
| `api.orders.verifyRating(data)` | `POST /ai/verify-rating` | 465–472 | Verifies rating screenshot matches expected data |
| `api.ops.analyzeProof(data)` | `POST /ai/verify-proof` | 723–731 | Analyzes proof-of-purchase screenshot |
| `api.chat.sendMessage(...)` | `POST /ai/chat` | 477–500 | AI chatbot with context (products, orders, tickets, history, image) |
| `api.ai.chat(...)` | `POST /ai/chat` | 941–951 | Duplicate/alternative chat endpoint |
| `api.ai.verifyProof(...)` | `POST /ai/verify-proof` | 952–962 | Duplicate/alternative proof verification endpoint |

**Note:** `api.ai.chat` and `api.ai.verifyProof` appear to be duplicate endpoints of `api.chat.sendMessage` and `api.ops.analyzeProof`. Consider consolidating.

### 5.2 AI Components

#### `shared/components/AiVerificationBadge.tsx` (191 lines)

Two exported components:
- **`RatingVerificationBadge`**: Displays AI verification results for ratings — shows match/mismatch for account name, product name, order ID, amount, plus confidence score. Has light/dark theme variants.
- **`ReturnWindowVerificationBadge`**: Displays return window status verification — shows days until expiry, expiry date, and return window assessment. Has light/dark theme variants.

Used in:
| File | Lines |
|------|-------|
| `Orders.tsx` | 974, 1587, 1865 |
| `MediatorDashboard.tsx` | 2020, 2285, 2343 |
| `AgencyDashboard.tsx` | 3548+ |
| `BrandDashboard.tsx` | 1319, 1368 |
| `AdminPortal.tsx` | 1982, 2019 |

#### `shared/components/Chatbot.tsx` (908 lines)

Full-featured AI chatbot with:
- **Voice input:** Web Speech API with `SpeechRecognition` (lines 197–260)
- **Image attachments:** File upload with 10 MB limit, base64 encoding (lines 280–340)
- **Context injection:** Sends top 10 products, last 5 orders, last 5 tickets, last 6 messages as conversation history (lines 390–430)
- **Context caching:** 60s TTL cache to avoid 3 API calls per message (line 121)
- **Request cancellation:** `AbortController` cancels in-flight AI requests on new message or unmount (lines 126–130, 356)
- **Graceful degradation:** On AI failure, falls back to keyword-based navigation ("deals" → Explore, "latest order" → Orders, "support" → Tickets) (lines 475–510)
- **Rate limiting feedback:** Detects `RATE_LIMITED`, `DAILY_LIMIT_REACHED`, `TOO_FREQUENT` error codes (line 474)
- **Retry button:** Failed messages show a retry button with the original text (lines 515, 739)
- **Navigation:** AI can respond with `navigateTo` intent to auto-switch tabs after 1.5s delay (lines 455–465)
- **Quick actions:** Deals, Latest Order, Tickets buttons for common queries (lines 528–532)
- **Memory cleanup:** Revokes blob URLs on unmount, clears timers, aborts pending requests (lines 135, 155–159)

Used in: `shared/pages/Home.tsx` (line 12)

### 5.3 AI Proof Validation Flow (in `Orders.tsx`)

The buyer order submission flow includes AI-powered validation:
- **Product name mismatch detection:** Line 511 — warns user if AI-extracted product name doesn't match expected
- **Account/product name mismatch:** Line 564 — warns on both account and product name mismatches
- **Proof validity check:** Line 634 — validates screenshot before submission
- **Image compression:** `compressImage()` called before AI upload to reduce payload (lines 310–350 of api.ts)

### 5.4 AI Code Quality Notes

- **No error fallback in AI badge components:** `AiVerificationBadge.tsx` assumes `verification` prop data is always well-formed. No null checks on nested properties like `verification.ratingMatch.accountName`.
- **Duplicate API surface:** `api.chat.sendMessage` and `api.ai.chat` both hit `/ai/chat`. Same for `api.ops.analyzeProof` and `api.ai.verifyProof`. This creates confusion about which to use.
- **60s timeout shared with AI:** The global 60s timeout (api.ts line 183) is used for both regular API calls and AI endpoints that "may take 15-45s". Consider separate timeout configs.

---

## Summary of Action Items

### Critical
1. **AgencyDashboard.tsx** — Replace all 8 raw `err.message` usages with `formatErrorMessage` (lines 1101, 1673, 1742, 1801, 1819, 2225, 2896, 2916)
2. **MediatorDashboard.tsx** — Replace 6 raw `err.message` usages with `formatErrorMessage` (lines 1255, 1266, 2443, 2502, 2533, 2627)
3. **BrandDashboard.tsx** — Replace 3 raw `err.message` usages with `formatErrorMessage` (lines 197, 1607, 2503)

### High Priority
4. **Token storage** — Consider moving refresh tokens to `httpOnly` cookies for production
5. **Duplicate AI API surface** — Consolidate `api.chat.sendMessage` / `api.ai.chat` and `api.ops.analyzeProof` / `api.ai.verifyProof`
6. **Audit trail gaps** — Add activity logs for Brand, Agency, and Mediator dashboards (currently only Admin has system-wide logs)

### Medium Priority
7. **Buyer wallet ledger** — Add transaction history page (API endpoint may already exist)
8. **Audit action filter** — Expand `filterAuditLogs` to surface more than 8 action types
9. **Audit export** — Add CSV/PDF export capability for audit trails
10. **AI timeout** — Consider separate timeout config for AI endpoints vs regular API calls

### Low Priority
11. **AiVerificationBadge** — Add null safety for nested verification properties
12. **Orders.tsx line 688** — Use `formatErrorMessage` instead of raw `e.message`
