# MOBO Ecosystem — Research Audit Report

**Scope:** 13 files across frontend pages, backend controllers, auth/notification context, and AI service  
**Date:** 2026  
**Methodology:** Line-by-line manual code review  

---

## Legend

| Priority | Meaning |
|----------|---------|
| **CRITICAL** | Data loss, money bugs, security holes — fix before any deploy |
| **HIGH** | Major UX/reliability issues — fix within the sprint |
| **MEDIUM** | Maintainability, consistency, performance — plan soon |
| **LOW** | Polish, minor edge cases — backlog |

---

## 1. CRITICAL

### 1.1 Settlement & Workflow in Separate MongoDB Sessions — Split-Brain Risk
**File:** `backend/controllers/opsController.ts` ~L1550-1590  
**Issue:** `settleOrderPayment` performs wallet moves (brand debit, buyer credit, mediator margin) in one atomic session, then transitions the order workflow (APPROVED → REWARD_PENDING → COMPLETED) in a *separate* `session.withTransaction()`. If the first session commits but the second fails (e.g. network blip, version conflict), money has moved but the order status hasn't changed. The order is stuck in APPROVED with funds already disbursed.  
**Recommendation:** Merge both operations into a single transaction, or implement a saga/compensation pattern with an outbox table so a background worker can retry the state transition.

### 1.2 Campaign Slot Leaked on Non-Purchase Proof Rejection
**File:** `backend/controllers/opsController.ts` ~L1170  
**Issue:** `rejectOrderProof` only releases the campaign slot (`$inc: { usedSlots: -1 }`) when `proofType === 'purchase'`. If rating, review, or return-window proof is rejected *and* the deal collapses, the slot is consumed permanently and never returned.  
**Recommendation:** Add slot release logic when a non-purchase rejection triggers the order to be marked FAILED. Track whether the slot was originally consumed and release it on any terminal failure state.

### 1.3 No Server-Side Idempotency Key on Order Creation
**File:** `shared/pages/Orders.tsx` ~L410-490 (client) + backend  
**Issue:** When a buyer submits a new order ("Claim Cashback"), there is only a client-side `submittingRef` guard. A network retry, double-click on slow connections, or browser refresh can create duplicate orders with identical deal data, consuming extra campaign slots.  
**Recommendation:** Generate a client-side UUID as an idempotency key, send it in the request header, and have the backend reject duplicates within a time window (e.g., 5 minutes).

### 1.4 Client-Side Product Name Matching Easily Bypassed
**File:** `shared/pages/Orders.tsx` ~L410-490  
**Issue:** The rating upload flow uses AI to check `accountNameMatch` and `productNameMatch` and blocks submission on mismatch. This check runs entirely in the browser — a user can intercept the API call and upload any image directly, bypassing validation.  
**Recommendation:** Re-run the AI rating verification server-side before accepting the proof. The client check should remain for UX but must not be the sole gate.

### 1.5 Payout Idempotency Falls Back to `Date.now()`
**File:** `backend/controllers/opsController.ts` ~L2440-2445  
**Issue:** `payoutMediator` builds its idempotency key from `x-request-id`. If the header is absent, it falls back to `MANUAL-${Date.now()}`, which is not idempotent — two rapid requests within the same millisecond would collide, but requests one second apart would create duplicate payouts.  
**Recommendation:** Require `x-request-id` (or a body field like `requestId`) for payout requests. Reject calls that don't include one.

---

## 2. HIGH

### 2.1 `window.confirm()` Used for All Destructive Actions
**Files:**  
- `shared/pages/BrandDashboard.tsx` ~L1440  
- `shared/pages/MediatorDashboard.tsx` ~L808, ~L1340  
- `shared/pages/AdminPortal.tsx` ~L200, ~L343, ~L447, ~L1700  
- `shared/pages/AgencyDashboard.tsx` ~L1695, ~L2160  

**Issue:** Every delete, settlement, unsettlement, and user toggle action uses `window.confirm()`, which is: (a) not styleable, (b) inaccessible on mobile PWAs (some WebViews suppress it), (c) blocks the main thread, and (d) provides no contextual information (e.g., the amount being settled).  
**Recommendation:** Replace with a custom confirmation modal component that shows the relevant entity details and uses consistent styling.

### 2.2 No Pagination on Core List Views
**Files:**  
- `shared/pages/MediatorDashboard.tsx` — buyer roster, all orders  
- `shared/pages/AdminPortal.tsx` ~L1600 — 200-row client-side limit with "showing 200" banner  
- `shared/pages/AgencyDashboard.tsx` — mediator orders, team roster  
- `shared/pages/BrandDashboard.tsx` — orders, campaigns  

**Issue:** All order/campaign lists fetch the entire dataset and render it client-side. The admin view hard-caps at 200 rows with a warning but no way to see the rest.  
**Recommendation:** Implement cursor-based pagination on the backend and infinite scroll or page controls on the frontend.

### 2.3 `getLedger` Hard Limit 2000 Records
**File:** `backend/controllers/opsController.ts` ~L535  
**Issue:** The ledger endpoint caps results at 2000 documents with no cursor or offset. Agencies with high transaction volume will silently lose visibility of older records.  
**Recommendation:** Add cursor-based pagination (e.g., `lastId` + `limit`) and expose total count.

### 2.4 `listMediatorCodesForAgency` Called Repeatedly Without Caching
**File:** `backend/controllers/opsController.ts` ~L860, ~L940, ~L1020, ~L1100, ~L1260, ~L1420  
**Issue:** Every verification and settlement call queries the database for the agency's mediator list to check scope. The same data is fetched multiple times within a single request flow and across rapid sequential calls.  
**Recommendation:** Cache per-request using `res.locals` or a short TTL in-memory cache (e.g., 30 seconds).

### 2.5 "All Systems Operational" Is Hardcoded
**File:** `shared/pages/AdminPortal.tsx` ~L1165  
**Issue:** The admin dashboard system status widget always shows "All Systems Operational" with green indicators. It is purely cosmetic.  
**Recommendation:** Wire it to an actual health-check endpoint that reports DB connectivity, AI circuit-breaker state, SSE connection count, and queue depth.

### 2.6 No Wallet Balance Pre-Check Before Settlement Session
**File:** `backend/controllers/opsController.ts` ~L1500  
**Issue:** `settleOrderPayment` starts a MongoDB transaction and then attempts `applyWalletDebit` on the brand's wallet. If the brand wallet has insufficient funds, the session aborts with a generic error. There is no pre-check or user-friendly message.  
**Recommendation:** Check `wallet.availablePaise >= amountPaise` before starting the transaction and return a clear `INSUFFICIENT_FUNDS` error.

### 2.7 `managerName` Used as Query Key Instead of User ID
**File:** `backend/controllers/opsController.ts` (multiple endpoints)  
**Issue:** Several queries filter orders by `managerName` (a mutable display string). If a user changes their name, historical orders become unreachable.  
**Recommendation:** Query by `managerId` (ObjectId reference) instead. Index the field.

### 2.8 `Promise.all` Instead of `Promise.allSettled` in AgencyDashboard `fetchData`
**File:** `shared/pages/AgencyDashboard.tsx` ~L3640  
**Issue:** The main data fetch uses `Promise.all([getMediators, getCampaigns, getOrders, getLedger])`. If *any* one call fails (e.g., ledger service is down), the entire dashboard shows a generic error and no data renders.  
**Recommendation:** Switch to `Promise.allSettled` and render partial data with per-section error states, as already done in `MediatorDashboard.tsx`.

### 2.9 Agency Quick Payout Has No Confirmation and No Max Amount Validation
**File:** `shared/pages/AgencyDashboard.tsx` ~L3200-3230  
**Issue:** The "Confirm Transfer" button on the Quick Payout panel fires immediately with no confirmation dialog and no maximum amount guard. A fat-finger entry could initiate a very large payout.  
**Recommendation:** Add a confirmation step showing the beneficiary name, amount, and UPI ID. Add a configurable max payout amount (e.g., ₹50,000 per transfer).

### 2.10 Default Query Limit 200 May Be Expensive
**File:** `backend/controllers/opsController.ts` (default pagination)  
**Issue:** Paginated endpoints default to `limit=200`. With large collections and no index hints, this generates full collection scans returning 200 documents per call.  
**Recommendation:** Lower default to 50, enforce a max of 200, and ensure proper compound indexes exist for common query patterns.

---

## 3. MEDIUM

### 3.1 Hardcoded Categories in Explore Page
**File:** `shared/pages/Explore.tsx` ~L22-24  
**Issue:** Product categories ("Electronics", "Fashion", etc.) are hardcoded in the component. Adding or removing a category requires a code change and deploy.  
**Recommendation:** Fetch categories from CSV config or a backend endpoint. Alternatively, derive them from existing product data.

### 3.2 Hardcoded 5-Star Default Rating
**File:** `shared/components/ProductCard.tsx` ~L76  
**Issue:** Every product card displays 5 filled stars regardless of actual rating data. Users see misleading perfect ratings.  
**Recommendation:** Either display actual rating data or remove the stars entirely until a real rating system exists.

### 3.3 OCR Confidence Capped at 85 Even With Perfect Match
**File:** `backend/services/aiService.ts` ~L820  
**Issue:** The verification function caps `confidenceScore` at 85 when OCR alone finds both order ID and amount. Even with a perfect deterministic match, the score never reaches 90+ without Gemini, which may unnecessarily flag clean results for manual review.  
**Recommendation:** Allow deterministic + OCR matches to reach 90+ when both fields pass regex validation and match expected values.

### 3.4 "GOD-LEVEL ACCURACY" in Production AI Prompts
**File:** `backend/services/aiService.ts` ~L900, ~L1430, ~L2170, ~L2370, ~L2460  
**Issue:** Multiple Gemini prompts contain "GOD-LEVEL ACCURACY REQUIRED" and "PRIORITY: GOD-LEVEL ACCURACY". These phrases consume tokens without improving extraction quality and look unprofessional in logs/debugging.  
**Recommendation:** Replace with precise technical instructions. Prompt engineering should focus on concrete rules, not hyperbole.

### 3.5 High-Contrast OCR Fallback Threshold Too Simplistic
**File:** `backend/services/aiService.ts` ~L780, ~L1300  
**Issue:** The Tesseract high-contrast fallback only triggers when extracted text is < 30 characters. A partially successful OCR returning 31 characters of garbage would skip the fallback.  
**Recommendation:** Also trigger fallback when the deterministic extraction yields no order ID *and* no amount, regardless of text length.

### 3.6 Agency Can Edit Mobile Number Without Re-Verification
**File:** `shared/pages/AgencyDashboard.tsx` ~L305  
**Issue:** The AgencyProfile form allows editing the mobile number and saving directly. For buyers, the mobile field is read-only (`Profile.tsx`). This inconsistency means an agency could change their contact number without any OTP re-verification.  
**Recommendation:** Either make mobile read-only (consistent with buyer) or require OTP verification on change.

### 3.7 Inconsistent Image Size Limits
**Files:**  
- `shared/pages/Profile.tsx` — 5 MB for buyer avatar  
- `shared/pages/MediatorDashboard.tsx` — 2 MB for mediator profile  

**Issue:** Different roles have different file size limits with no technical justification. A mediator uploading a slightly larger image gets a confusing rejection.  
**Recommendation:** Unify to 5 MB across all roles, or document the rationale for different limits.

### 3.8 `copyCampaign` Duplicated in Two Controllers
**Files:**  
- `backend/controllers/opsController.ts` ~L2563  
- `backend/controllers/brandController.ts` (similar logic)  

**Issue:** Campaign copy logic is implemented independently in both controllers with potential for drift. Auth checks differ slightly.  
**Recommendation:** Extract shared logic into a service function called by both controllers.

### 3.9 No Per-User AI Rate Limiting
**File:** `backend/services/aiService.ts` (entire file)  
**Issue:** The circuit breaker throttles globally when Gemini is failing, but there is no per-user rate limit. A single user could trigger dozens of AI extractions in rapid succession, exhausting API quota.  
**Recommendation:** Add per-user rate limiting (e.g., 10 extractions per minute per user) at the API route level.

### 3.10 AI Metrics Collected But Never Exported
**File:** `backend/services/aiService.ts` — `recordGeminiSuccess`, `recordGeminiFailure`  
**Issue:** The service tracks success/failure counts for circuit-breaker decisions but never exposes these metrics for monitoring (no `/metrics` endpoint, no logging interval).  
**Recommendation:** Expose via a `/health` or `/metrics` endpoint, or log periodically (e.g., every 5 minutes).

### 3.11 Tesseract PSM Mode Passed as `'6' as any`
**File:** `backend/services/aiService.ts` ~L2340  
**Issue:** Page segmentation mode is passed as `'6' as any` to bypass TypeScript. If Tesseract.js changes its API, this will fail silently at runtime.  
**Recommendation:** Use the proper enum/constant from the `tesseract.js` package (`PSM.ASSUME_UNIFORM_BLOCK`).

### 3.12 Campaign Create Modal Missing Description Field
**Files:**  
- `shared/pages/AgencyDashboard.tsx` ~L2200  
- `shared/pages/BrandDashboard.tsx` (campaign form)  

**Issue:** The campaign creation form has title, image, platform, price, payout, and deal type — but no description/instructions field. Brands cannot communicate product-specific requirements or restrictions to the sales chain.  
**Recommendation:** Add an optional description/notes field to the campaign model and form.

### 3.13 Admin Settings Panel Is a Shell
**File:** `shared/pages/AdminPortal.tsx` ~L1780  
**Issue:** The Settings view shows a read-only "BUZZMA Ecosystem" platform name and an editable admin email field. There are no actual system configuration options (e.g., settlement cooldown period, image size limits, AI model selection).  
**Recommendation:** Either populate with real system settings or remove the tab until it has functionality.

### 3.14 Audit Log Metadata Truncated to 80 Characters
**File:** `shared/pages/AdminPortal.tsx` ~L2050  
**Issue:** The audit log table truncates the `details` column to 80 characters. Critical metadata (e.g., full error messages, wallet IDs, rejection reasons) is hidden. There is no expand/detail view.  
**Recommendation:** Add a click-to-expand behavior or a detail modal for audit log rows.

### 3.15 Hardcoded Version "v3.0.1 Stable" in Admin Dashboard
**File:** `shared/pages/AdminPortal.tsx` ~L1160  
**Issue:** The system status widget displays a hardcoded version string. It will be wrong after every deploy.  
**Recommendation:** Read from `package.json` version or a build-time environment variable.

### 3.16 OCR Variant Explosion — Up to 12 Image Crops Per Extraction
**File:** `backend/services/aiService.ts` ~L2530-2600  
**Issue:** For desktop screenshots, the service generates up to 12 preprocessed image variants (original, enhanced, high-contrast, inverted, plus 8 crop regions). Each is sent through Gemini OCR or Tesseract. This is expensive in both API cost and latency.  
**Recommendation:** Implement a two-pass strategy: try original + enhanced first, and only fall back to crop variants if the primary pass yields no results.

### 3.17 Revenue Calculated Client-Side From All Orders
**File:** `shared/pages/AgencyDashboard.tsx` ~L3660  
**Issue:** `stats.revenue` is computed by summing `order.total` for every order in the client-side array. As the order count grows, this becomes inaccurate (due to the 200-row default limit) and wasteful.  
**Recommendation:** Add a server-side aggregation endpoint that returns pre-computed stats.

### 3.18 `extractProductName` May False-Positive on Address Lines
**File:** `backend/services/aiService.ts` ~L1900  
**Issue:** The scoring system awards points for product-like keywords (phone, bag, cream, etc.) and penalizes addresses. However, a long line like "Free delivery to your Laptop Stand, Mumbai 400001" would score positively because of "Laptop".  
**Recommendation:** Add a negative score for lines containing pincode patterns or city names *alongside* product keywords, rather than relying solely on independent checks.

### 3.19 Campaign `locked` After First Assignment — No UI Indicator
**File:** `backend/controllers/opsController.ts` ~L2240  
**Issue:** The `assignSlots` endpoint sets a `locked` flag on the campaign after the first slot assignment. There is no UI indication that the campaign is locked. Users trying to edit locked campaigns will get opaque error messages.  
**Recommendation:** Show a "Locked" badge on the campaign card after first assignment, with a tooltip explaining what it means.

### 3.20 Realtime Debounce Inconsistencies
**Files:**  
- `shared/pages/MediatorDashboard.tsx` — 600 ms  
- `shared/pages/BrandDashboard.tsx` — 400 ms  
- `shared/pages/AgencyDashboard.tsx` — 900 ms  

**Issue:** Each dashboard uses a different SSE debounce interval with no documented rationale. The agency portal's 900 ms delay may feel sluggish; the brand's 400 ms may cause thrashing.  
**Recommendation:** Standardize to a single tunable constant (e.g., 500 ms) in a shared config, or document why each role needs different timing.

---

## 4. LOW

### 4.1 No Email Field in Buyer Profile
**File:** `shared/pages/Profile.tsx`  
**Issue:** The buyer profile form has name, mobile (read-only), avatar, UPI, QR, and referral code — but no email. This prevents email-based communications (receipts, password resets, marketing).  
**Recommendation:** Add an optional email field.

### 4.2 Notification Polling at 30-Second Interval
**File:** `shared/context/NotificationContext.tsx`  
**Issue:** The notification polling interval is 30 seconds. Combined with SSE realtime for data updates, the polling is likely redundant and adds unnecessary server load.  
**Recommendation:** Switch to SSE-driven notifications (the SSE infrastructure already exists) and remove polling, or increase the interval to 60+ seconds.

### 4.3 No Client-Side Rate Limiting on Login
**File:** `shared/context/AuthContext.tsx`  
**Issue:** The `login` function has no client-side throttle. A malicious script or frustrated user could spam login attempts.  
**Recommendation:** Add a simple exponential backoff or 3-attempts-per-30-seconds limit on the client side (in addition to any server-side rate limiting).

### 4.4 `sanitizeOrderId` Rejects UUIDs
**File:** `backend/services/aiService.ts` ~L1590  
**Issue:** The `sanitizeOrderId` function strips hyphens only for known patterns and may reject UUID-formatted order IDs (e.g., `550e8400-e29b-41d4-a716-446655440000`) used by some newer platforms.  
**Recommendation:** Add UUID as a recognized order ID format.

### 4.5 Ticket Deletion Error Message Unclear
**File:** `shared/pages/Orders.tsx` ~L1725  
**Issue:** The delete button for support tickets is hidden when `status === 'Open'`, but there is no explanation of *why* the user can't delete an open ticket. The button simply doesn't appear.  
**Recommendation:** Show a disabled button with a tooltip: "Close the ticket before deleting."

### 4.6 50-Notification Cap May Lose Important Notifications
**File:** `shared/context/NotificationContext.tsx`  
**Issue:** The context keeps only the latest 50 notifications in state. Older ones are silently dropped with no "load more" mechanism.  
**Recommendation:** Add a "View all" link that opens a paginated notification history.

### 4.7 No `alt` Text on Several Product Images
**Files:**  
- `shared/pages/AgencyDashboard.tsx` — mediator order cards `<img>` with no `alt`  
- `shared/pages/MediatorDashboard.tsx` — some proof images missing `alt`  

**Issue:** Accessibility violation — screen readers cannot describe these images.  
**Recommendation:** Add descriptive `alt` attributes (e.g., "Product image for {title}").

### 4.8 QR Code Copy Copies Raw Image Data/URL
**File:** `shared/pages/AgencyDashboard.tsx` ~L3140  
**Issue:** The "Copy" button on the UPI QR section copies `selectedMediator.qrCode` to clipboard, which is likely a base64 data URL or long image URL. This is not useful when pasted.  
**Recommendation:** Copy the UPI ID instead, or offer a "Download QR" button.

### 4.9 `PayoutsView` Creates CSV Blobs Manually
**File:** `shared/pages/AgencyDashboard.tsx` (PayoutsView)  
**Issue:** The payout CSV export builds the blob manually with string concatenation instead of using the shared `downloadCsv` utility used elsewhere.  
**Recommendation:** Refactor to use the shared CSV utility for consistency and proper escaping.

### 4.10 Explore Page Keyword Search Only
**File:** `shared/pages/Explore.tsx`  
**Issue:** The search is a simple case-insensitive `includes()` match on title and description. No fuzzy matching, no search by platform, no price filters.  
**Recommendation:** Add filter chips for platform and price range. Consider a lightweight fuzzy search library.

### 4.11 `getTransactions` Hard Limit 500
**File:** `backend/controllers/opsController.ts` ~L2545  
**Issue:** The transactions endpoint caps at 500 results with no pagination parameters.  
**Recommendation:** Add cursor-based pagination, consistent with other list endpoints.

### 4.12 `extractAmounts` Aadhaar/Timestamp Exclusion Patterns May Be Incomplete
**File:** `backend/services/aiService.ts` (extractAmounts)  
**Issue:** The function excludes 12-digit Aadhaar numbers and Unix timestamps, but the patterns are Indian-specific. If the platform expands internationally, these heuristics will need revisiting.  
**Recommendation:** Document these as India-specific heuristics and flag for review if multi-country support is planned.

### 4.13 No Loading Skeleton on Dashboard Stat Cards
**Files:**  
- `shared/pages/AdminPortal.tsx`  
- `shared/pages/AgencyDashboard.tsx`  
- `shared/pages/BrandDashboard.tsx`  

**Issue:** Stat cards show "0" or empty values while data is loading, then jump to real values. This is visually jarring.  
**Recommendation:** Show shimmer/skeleton placeholders during the loading state.

### 4.14 Dark Mode Screenshots May Fail OCR Silently
**File:** `backend/services/aiService.ts` — `preprocessForOcr` inverted mode  
**Issue:** The "inverted" preprocessing mode is always included as a variant, but there is no detection of whether the screenshot is actually dark-mode. This wastes one OCR pass. Conversely, if the only pass that would work is "inverted" but it's attempted late in the variant list, the early-exit logic may break before trying it.  
**Recommendation:** Add a quick dark-mode detection heuristic (e.g., average pixel brightness < threshold) and prioritize the inverted variant when detected.

---

## Summary

| Priority | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH | 10 |
| MEDIUM | 20 |
| LOW | 14 |
| **Total** | **49** |

### Top 5 Actions (Ordered by Impact)

1. **Merge settlement + workflow transition into a single atomic session** (Critical 1.1)
2. **Add server-side idempotency keys for order creation and payouts** (Critical 1.3, 1.5)
3. **Fix slot leak on non-purchase proof rejection** (Critical 1.2)
4. **Replace `window.confirm()` with custom confirmation modals** (High 2.1)
5. **Implement cursor-based pagination** across all list endpoints (High 2.2, 2.3)
