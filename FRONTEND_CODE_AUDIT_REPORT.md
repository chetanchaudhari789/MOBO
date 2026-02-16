# BUZZMA / MOBO — Frontend Code Audit Report

**Scope:** All files under `shared/` — pages, components, context, hooks, utils, services, types  
**Date:** 2025  
**Auditor:** Automated deep-read audit  
**Files audited:** 12 pages, 12 components, 5 context providers, 6+ utility modules, 1 service client, 1 type definition file

---

## Executive Summary

The shared frontend codebase powers 5 distinct apps (buyer, mediator, agency, brand, admin) from a single shared React+TypeScript library. Overall architecture is solid — strong realtime integration, AI-powered verification, proper token refresh, and comprehensive deal lifecycle flows. However, the audit uncovered **78 actionable findings** across 9 categories: accessibility violations, type-safety bypasses, hardcoded values, missing error handling, state management issues, missing pagination, inconsistent patterns, incomplete features, and missing audit trail display.

**Critical findings:** 12 bare `confirm()` calls for destructive actions, 60+ `as any` type casts, 10+ `<img>` tags missing `alt` attributes, zero pagination on any data table, hardcoded statistical trends across all dashboards, and inconsistent realtime debounce timers.

---

## 1. Accessibility Issues

### 1.1 Missing `alt` attributes on `<img>` elements (WCAG 1.1.1)

| # | File | Line | Element | Fix |
|---|------|------|---------|-----|
| 1 | `shared/pages/AgencyDashboard.tsx` | L1813 | Inventory table campaign image | Add `alt={c.title \|\| 'Campaign'}` |
| 2 | `shared/pages/AgencyDashboard.tsx` | L1994 | Offered campaigns grid image | Add `alt={c.title \|\| 'Campaign'}` |
| 3 | `shared/pages/AgencyDashboard.tsx` | L2233 | Assign modal campaign image | Add `alt={assignModal.title \|\| 'Campaign'}` |
| 4 | `shared/pages/AgencyDashboard.tsx` | L3001 | Order history item image | Add `alt={o.items?.[0]?.title \|\| 'Product'}` |
| 5 | `shared/pages/BrandDashboard.tsx` | L932 | Orders table product image | Add `alt={o.items?.[0]?.title \|\| 'Product'}` |
| 6 | `shared/pages/BrandDashboard.tsx` | L1676 | Campaign form preview image | Add `alt={form.title \|\| 'Preview'}` |
| 7 | `shared/pages/MediatorDashboard.tsx` | L2601 | Deal builder product image | Add `alt={dealBuilder.title \|\| 'Product'}` |
| 8 | `shared/pages/Orders.tsx` | L1412 | Product list image (`alt=""`) | Change to `alt={p.title}` |
| 9 | `shared/pages/Orders.tsx` | L1433 | Selected product image (`alt=""`) | Change to `alt={selectedProduct.title}` |

### 1.2 Bare `confirm()` / `window.confirm()` for destructive actions (12 instances)

Native `confirm()` blocks the main thread, cannot be styled, is not screen-reader friendly, and provides no undo mechanism. Every destructive action should use a custom confirmation modal with proper focus management and `aria-` attributes.

| # | File | Line | Action |
|---|------|------|--------|
| 1 | `shared/pages/AgencyDashboard.tsx` | L916 | Delete payout record |
| 2 | `shared/pages/AgencyDashboard.tsx` | L1633 | Delete campaign |
| 3 | `shared/pages/MediatorDashboard.tsx` | L802 | Delete unpublished campaign |
| 4 | `shared/pages/MediatorDashboard.tsx` | L1198 | Confirm settlement |
| 5 | `shared/pages/MediatorDashboard.tsx` | L1211 | Undo settlement |
| 6 | `shared/pages/BrandDashboard.tsx` | L1437 | Delete campaign |
| 7 | `shared/pages/BrandDashboard.tsx` | L2344 | Disconnect agency |
| 8 | `shared/pages/AdminPortal.tsx` | L473 | Delete wallet |
| 9 | `shared/pages/AdminPortal.tsx` | L490 | Delete user |
| 10 | `shared/pages/AdminPortal.tsx` | L506 | Delete product/deal |
| 11 | `shared/pages/AdminPortal.tsx` | L538 | Delete ticket |
| 12 | `shared/pages/AdminPortal.tsx` | L557 | Delete access code |

### 1.3 Missing keyboard/focus management

- **No focus trap** in any modal (mediator detail, proof viewer, campaign create, assign, deal builder). Users can Tab out of open modals.
- **No `aria-modal="true"` or `role="dialog"`** on any modal overlay across all dashboards.
- **No `Escape` key handler** to close modals (only backdrop click and X button).
- `shared/pages/MediatorAuth.tsx` — "pending" view has no `aria-live="polite"` region for the status update message.

### 1.4 Color contrast concerns

- Several status badges use very small text (`text-[9px]`, `text-[10px]`) with light backgrounds (e.g., `text-slate-400` on white) — may fail WCAG AA contrast ratio for small text.
- `shared/pages/AgencyDashboard.tsx` L1195–1210: StatCard trend values (`text-green-600` on white) are borderline at 10px font size.

---

## 2. TypeScript Safety / Type Bypass Issues

### 2.1 Excessive `as any` casts (60+ instances across shared/pages)

The most significant type-safety issue. These bypass compile-time checks and hide potential runtime errors.

**Systemic patterns:**

| Pattern | Files | Fix |
|---------|-------|-----|
| `(screenshots as any)?.returnWindow` | AgencyDashboard L541/L3406, BrandDashboard L772/L1194/L1201, MediatorDashboard L2277/L2279, Orders L1841/L1843 | Add `returnWindow?: string` to `Order.screenshots` in `types.ts` (it's already defined there! — the type has `returnWindow` but code still casts) |
| `(o as any).reviewerName` | AgencyDashboard L527, BrandDashboard L758/L804, Orders L544 | `reviewerName` is already on the `Order` type — remove `as any` |
| `(o as any).orderDate` | AgencyDashboard L533 | `orderDate` is already on the `Order` type — remove `as any` |
| `(o as any).soldBy` | AgencyDashboard L532/L575 | `soldBy` is already on the `Order` type — remove `as any` |
| `(o as any).extractedProductName` | AgencyDashboard L534/L577 | `extractedProductName` is already on the `Order` type — remove `as any` |
| `(c as any).assignmentDetails` | AgencyDashboard L1601/L1886 | `assignmentDetails` is already on the `Campaign` type — remove `as any` |
| `(verification as any)?.returnWindowVerified` | MediatorDashboard L2186/L2191/L2196/L2201 | `returnWindowVerified` is already on `Order.verification` — remove `as any` |
| `(aiAnalysis as any).detectedOrderId`/`.detectedAmount` | MediatorDashboard L2070/L2072/L2087/L2089, AgencyDashboard L3255/L3261 | Extend `AiProofVerificationResult` type to include these fields |
| `(e as any)?.message` | MediatorDashboard L1622/L1671, BrandDashboard L195/L2057, Profile L85/L131 | Use `formatErrorMessage()` from `shared/utils/errors.ts` consistently |
| `(dealBuilder as any).assignmentPayout` | MediatorDashboard L2617/L2649 | `assignmentPayout` is already on `Campaign` type — use typed prop |
| `(opts as any).silent` | MediatorDashboard L1578 | Define proper parameter type: `(opts?: { silent?: boolean })` |

### 2.2 Component props typed as `any`

| File | Line(s) | Component | Fix |
|------|---------|-----------|-----|
| `shared/pages/AgencyDashboard.tsx` | ~L51–70 | `SidebarItem`, `StatCard` | Define proper prop interfaces |
| `shared/pages/AgencyDashboard.tsx` | ~L75–150 | `PayoutsView`, `FinanceView`, `InventoryView`, `TeamView` | Define proper prop interfaces |

### 2.3 Unused variables

| File | Line | Variable | Issue |
|------|------|----------|-------|
| `shared/pages/MediatorDashboard.tsx` | L1536 | `_orderAuditEvents` | Declared with underscore prefix but state hook allocates memory; remove or use |
| `shared/pages/Profile.tsx` | L27 | `_setMobile` | Mobile setter prefixed with underscore (mobile is readonly), pattern is correct but could use `const [mobile] = useState(...)` instead |

---

## 3. Hardcoded Values

### 3.1 Fake/placeholder statistics displayed as real data

| # | File | Line(s) | Hardcoded Value | Impact |
|---|------|---------|-----------------|--------|
| 1 | `shared/pages/AgencyDashboard.tsx` | L1195–1210 | `"+12%"`, `"+24"`, `"Growing"` in StatCards | Users see fake growth metrics |
| 2 | `shared/pages/AdminPortal.tsx` | L1065 | `"+24% this week"` StatCard trend | Fake analytics in admin view |
| 3 | `shared/pages/AdminPortal.tsx` | L1090 | `"Weekly"` chart label with no selector | No way to change time range |
| 4 | `shared/pages/AdminPortal.tsx` | L1140–1145 | `"All Systems Operational"` / `"Last check: Just now"` | No real health-check integration |
| 5 | `shared/pages/AdminPortal.tsx` | sidebar | `"v3.0.1 Stable"` | Hardcoded version string |
| 6 | `shared/pages/BrandDashboard.tsx` | ~L2490 | `"High Volume"` badge on ALL agencies | Always shows regardless of actual order volume |
| 7 | `shared/pages/AgencyDashboard.tsx` | various | `"admin@buzzma.world"` default admin email | Should come from system config |

### 3.2 Magic numbers

| # | File | Line(s) | Value | Purpose | Fix |
|---|------|---------|-------|---------|-----|
| 1 | `shared/pages/AdminPortal.tsx` | ~L1550 | `200` | Order display cap | Extract to constant, add proper pagination |
| 2 | `shared/pages/AdminPortal.tsx` | audit view | `200` | Audit log query limit | Extract to constant |
| 3 | `shared/pages/BrandDashboard.tsx` | ~L2066 | `1000000` (₹10,00,000) | Max payout per transaction | Extract to config constant |
| 4 | `shared/pages/Orders.tsx` | various | `50 * 1024 * 1024` | MAX_PROOF_SIZE_BYTES (50MB) | Seems excessive for mobile screenshots; consider 10MB |
| 5 | `shared/pages/AgencyDashboard.tsx` | proof | `"5 Stars"` | Rating badge always shows 5 stars | Should reflect actual detected rating |

### 3.3 Hardcoded categories in Explore

| File | Line | Issue |
|------|------|-------|
| `shared/pages/Explore.tsx` | L24 | Categories hardcoded to `['All', 'Electronics', 'Fashion', 'Beauty', 'Home']` — should be derived from actual product data or fetched from API |
| `shared/pages/Explore.tsx` | L78–98 | Category matching uses hardcoded keyword lists (`shirt`, `pant`, `shoe`, `perfume`, `serum`, etc.) instead of proper category taxonomy |

---

## 4. Missing Error Handling

### 4.1 Silent `.catch(console.error)` without user feedback

| # | File | Context |
|---|------|---------|
| 1 | `shared/pages/AgencyDashboard.tsx` | Several API calls in `fetchData` catch block logs to console but `toast.error` is only called for some errors |
| 2 | `shared/pages/MediatorDashboard.tsx` L1698 | AI analysis AbortError is silently swallowed (correct) but other errors show generic message |
| 3 | `shared/pages/Profile.tsx` L85 | `(e as any)?.message` cast in catch — should use `formatErrorMessage()` |

### 4.2 Missing loading/error states

| # | File | Context | Fix |
|---|------|---------|-----|
| 1 | `shared/pages/Explore.tsx` | No error state when `api.products.getAll()` fails — products just stay empty | Show error banner with retry button |
| 2 | `shared/pages/BrandDashboard.tsx` | Agency partner data fetch has no loading indicator | Add skeleton/spinner while loading |
| 3 | `shared/pages/AgencyDashboard.tsx` | BrandsView component handles its own data fetching but errors are only console.logged | Surface to user |

### 4.3 Inconsistent error message formatting

- Some files use `formatErrorMessage(err, fallback)` from `shared/utils/errors.ts` (Auth pages do this correctly)
- Other files use `(e as any)?.message || 'fallback'` pattern (Profile, MediatorDashboard, BrandDashboard)
- **Recommendation:** Use `formatErrorMessage()` everywhere for consistency and request-ID propagation

---

## 5. Missing Edge Cases

### 5.1 No pagination on any data table or list

**This is the single most impactful missing feature.** Every dashboard fetches ALL data and renders it in full. With real production data, this will cause:

- Slow rendering (hundreds/thousands of DOM nodes)
- Memory pressure on mobile devices
- Long API response times

| File | Component | Data |
|------|-----------|------|
| `shared/pages/AdminPortal.tsx` | Users table | All users |
| `shared/pages/AdminPortal.tsx` | Orders table | Capped at 200 (L1550) with no "load more" |
| `shared/pages/AdminPortal.tsx` | Audit logs | Capped at 200 with no "load more" |
| `shared/pages/BrandDashboard.tsx` | Orders table | All brand orders |
| `shared/pages/BrandDashboard.tsx` | Campaign list | All campaigns |
| `shared/pages/AgencyDashboard.tsx` | Finance table | All orders |
| `shared/pages/AgencyDashboard.tsx` | Payouts table | All payout records |
| `shared/pages/AgencyDashboard.tsx` | Mediator roster | All mediators |
| `shared/pages/MediatorDashboard.tsx` | Buyer list | All buyers |
| `shared/pages/Orders.tsx` | Order list | All user orders |
| `shared/pages/Explore.tsx` | Product grid | All products |

### 5.2 `colSpan` mismatches

| File | Line | Issue |
|------|------|-------|
| `shared/pages/AdminPortal.tsx` | ~L1545 | `colSpan={5}` but the Finance/Orders table header has 6 columns (Order, Product, Buyer, Status, Amount, Actions). The "no results" row won't span the full width. |

### 5.3 Race conditions

| File | Line | Issue |
|------|------|-------|
| `shared/pages/MediatorDashboard.tsx` | L1578 | `loadData` with `silent` option checks `(opts as any).silent` — if rapid realtime events trigger concurrent loads, multiple in-flight requests could clobber state |
| `shared/pages/Profile.tsx` | L75 | `if (isStatsLoading) return;` guard prevents concurrent fetches but doesn't queue a retry if data changed during the in-flight request |

### 5.4 Missing input validation

| File | Line | Issue |
|------|------|-------|
| `shared/pages/AgencyDashboard.tsx` | ~L2700 | Payout amount input (`type="number"`) has no `min`/`max` attributes — user could enter negative amounts (only validated in JS via `Number(payoutAmount) <= 0`) |
| `shared/pages/BrandDashboard.tsx` | ~L2066 | Max payout of ₹10,00,000 is only validated client-side — no server validation mentioned |
| `shared/pages/MediatorDashboard.tsx` | L2625 | Uses `parseInt(commission)` which parses partial strings like `"10abc"` → 10, while L1664 uses `Math.trunc(Number(commission || 0))` — inconsistent |

### 5.5 Image error handling

| File | Issue |
|------|-------|
| `shared/pages/AgencyDashboard.tsx` | Multiple `<img>` tags for product/campaign images have no `onError` fallback — broken images show browser default broken icon |
| `shared/pages/BrandDashboard.tsx` | Same — no `onError` on campaign images in orders table (L932), preview (L1676) |
| `shared/pages/MediatorDashboard.tsx` | Same — no `onError` on deal builder image (L2601) |
| `shared/components/ProductCard.tsx` | ✅ Correctly has `onError` fallback to placeholder — this pattern should be replicated |

---

## 6. State Management Issues

### 6.1 Data duplication across components

- Each dashboard (Agency, Brand, Mediator, Admin) fetches its own copy of orders, users, campaigns. When the same data appears in multiple open tabs, there's no shared cache and the copies can drift.
- `shared/pages/MediatorDashboard.tsx` L1610-1616: Manual stale-check comparison `(updated.name !== (prev as any).name || ...)` is fragile and uses `as any` casts.

### 6.2 Unused state allocations

| File | Line | State | Issue |
|------|------|-------|-------|
| `shared/pages/MediatorDashboard.tsx` | L1536 | `_orderAuditEvents` | Set but never read — allocated state & re-renders wasted |
| `shared/pages/BrandDashboard.tsx` | ~L1350 | `setDetailView` | State setter for `detailView` called but the value is never used in rendering |

### 6.3 Context provider coupling

- `shared/context/AuthContext.tsx` L61: Realtime refresh uses a 600ms debounce timer for user data sync.
- Each dashboard also has its own realtime subscription with different debounce timers (see §7.1).
- If AuthContext refreshes user state, it triggers re-renders that may overlap with dashboard-level data refreshes.

---

## 7. Inconsistent Patterns

### 7.1 Realtime debounce timers vary across dashboards

| Dashboard | Debounce | File | Line |
|-----------|----------|------|------|
| AuthContext user sync | 600ms | `shared/context/AuthContext.tsx` | L55 |
| Explore deals refresh | 400ms | `shared/pages/Explore.tsx` | L49 |
| Profile stats refresh | 600ms | `shared/pages/Profile.tsx` | L60 |
| MediatorDashboard | 600ms | `shared/pages/MediatorDashboard.tsx` | ~L1645 |
| BrandDashboard | 900ms | `shared/pages/BrandDashboard.tsx` | realtime effect |
| AgencyDashboard | 900ms | `shared/pages/AgencyDashboard.tsx` | ~L3659 |
| AdminPortal | 900ms | `shared/pages/AdminPortal.tsx` | realtime effect |

**Recommendation:** Extract a shared `REALTIME_DEBOUNCE_MS` constant or use a shared `useDebouncedRealtime` hook.

### 7.2 CSV export: shared helper vs. manual construction

- `shared/utils/csvHelpers.ts` provides `csvSafe()` and `downloadCsv()` with proper CSV injection protection and UTF-8 BOM.
- `shared/pages/BrandDashboard.tsx` payout ledger (L2409–2430) builds CSV manually: `rows.map(r => r.join(',')).join('\n')` — **no injection protection, no BOM, no quoting**.
- `shared/pages/AgencyDashboard.tsx` FinanceView and PayoutsView correctly use `csvSafe()` + `downloadCsv()`.

### 7.3 Currency formatting inconsistency

| Pattern | Files |
|---------|-------|
| `formatCurrency(amount)` (proper helper) | AgencyDashboard, MediatorDashboard, Orders |
| `₹${amount.toLocaleString()}` (inline) | AdminPortal users table, Profile wallet |
| `{product.price.toLocaleString()}` (no ₹ prefix) | ProductCard |

### 7.4 Error casting inconsistency

| Pattern | Files |
|---------|-------|
| `formatErrorMessage(err, fallback)` ✅ | Auth.tsx, AgencyAuth.tsx, BrandAuth.tsx, MediatorAuth.tsx |
| `(e as any)?.message \|\| 'fallback'` ❌ | Profile.tsx, MediatorDashboard.tsx, BrandDashboard.tsx |
| `err instanceof Error ? err.message : 'fallback'` | AgencyDashboard.tsx |

---

## 8. Incomplete Features

### 8.1 Bank details UI declared but never editable

- `shared/pages/MediatorDashboard.tsx` L975-980: `MediatorProfileView` initializes `bankDetails` state with individual fields (`accountNumber`, `ifsc`, `bankName`, `holderName`) but has **no input fields** for editing them. The profile edit form only allows avatar, name, UPI ID, and QR code changes.
- Same for `shared/pages/Profile.tsx` (buyer profile) — only UPI ID and QR code editable, no bank details UI even though the `User` type supports it.

### 8.2 Admin system health — no real integration

- `shared/pages/AdminPortal.tsx` L1140: "All Systems Operational" is hardcoded with no backend health-check API call.
- "Last check: Just now" is static text with no timestamp tracking.

### 8.3 Chart time range — no selector

- `shared/pages/AdminPortal.tsx` L1090: Revenue chart shows "Weekly" label but has no date range selector or toggle for daily/monthly views.
- `shared/pages/AgencyDashboard.tsx` L1253: Date range selector `onChange` uses `as any` cast: `setRange(e.target.value as any)`.

### 8.4 Explore category system

- `shared/pages/Explore.tsx` L24: Categories are hardcoded to 5 values instead of being derived from product data.
- L78-98: Category matching relies on keyword detection in product titles (e.g., `title.includes('shirt')` for "Fashion") — this is fragile and will miss many products.

### 8.5 No "forgot password" flow

- None of the 4 auth pages (Auth, AgencyAuth, BrandAuth, MediatorAuth) have password reset or "forgot password" functionality.

### 8.6 No offline indicator on dashboards

- `shared/services/api.ts` has offline detection (`!navigator.onLine` guard), but none of the dashboards show a visible "you're offline" banner when network is unavailable. Only `api.ts` throws an error that gets caught in generic error handling.

---

## 9. Missing Audit Trail Display

### 9.1 Audit trail — on-demand only, not proactive

- `shared/pages/AdminPortal.tsx`: Audit logs view requires the admin to manually click "Fetch Logs" — they are not auto-loaded on view mount. If an admin switches to the Audit tab, they see an empty state until they interact.
- Audit logs are fetched with `limit: 200` hardcoded — no pagination or infinite scroll for older entries.

### 9.2 Order activity log — collapsed by default

- All proof modals (Agency, Mediator, Admin, Brand) render the order audit trail collapsed behind a `▼` toggle. Activity is invisible unless the user explicitly expands it.
- `shared/pages/AgencyDashboard.tsx` L3543: Audit trail in proof modal loads on expand (good for performance) but has no auto-expand for orders with recent activity.

### 9.3 Audit log filtering — limited

- `shared/utils/auditDisplay.ts`: Only 8 action types are surfaced (ORDER_CREATED, PROOF_SUBMITTED, etc.). Business-critical actions like `USER_APPROVED`, `USER_SUSPENDED`, `CAMPAIGN_CREATED`, `PAYOUT_SENT`, `WALLET_CREDITED` are **filtered out** by `VISIBLE_ACTIONS`.
- No way for admin to see the unfiltered raw audit log in the order activity modal.

### 9.4 No audit trail on non-order actions

- Campaign creation/deletion, agency connection/disconnection, mediator approval/rejection, payout execution — none of these show any activity history in the UI even though backend likely logs them.
- `shared/pages/BrandDashboard.tsx`: Agency "Disconnect" action has no audit trail or reversible action history.

---

## 10. Security Observations (Frontend)

### 10.1 Clipboard writes without permission check

- Multiple files use `navigator.clipboard.writeText()` (invite codes, UPI IDs, mediator codes) without checking `navigator.clipboard` availability or catching `DOMException` on permission denial.
- `shared/pages/AgencyDashboard.tsx` L2828: `navigator.clipboard.writeText(inviteCode)` — no toast confirmation, no error handling.

### 10.2 CSP / external resource loading

- `shared/pages/AgencyAuth.tsx` L82 and `shared/pages/BrandAuth.tsx` L79: Load external image via `bg-[url('https://grainy-gradients.vercel.app/noise.svg')]` — this creates a dependency on an external service and would violate strict CSP policies.

### 10.3 Token storage

- `shared/context/AuthContext.tsx`: Tokens stored in `localStorage` (`mobo_tokens_v1`, `mobo_session`). While standard practice, this makes them accessible to any XSS. The codebase should ensure strong CSP headers to mitigate.

---

## 11. Performance Concerns

### 11.1 No virtualization for long lists

- All data tables render every row in the DOM. For admin views with 200+ users/orders, or agency views with hundreds of mediator orders, this causes unnecessary DOM nodes and slow scroll.
- **Recommendation:** Use `react-window` or `@tanstack/virtual` for tables exceeding ~50 rows.

### 11.2 Large component files

| File | Lines | Components per file |
|------|-------|-------------------|
| `shared/pages/AgencyDashboard.tsx` | 3786 | 8+ sub-components |
| `shared/pages/MediatorDashboard.tsx` | 2714 | 6+ sub-components |
| `shared/pages/BrandDashboard.tsx` | 2704 | 6+ sub-components |
| `shared/pages/AdminPortal.tsx` | 2072 | 5+ sub-components |
| `shared/pages/Orders.tsx` | 2078 | 4+ sub-components |

These files should be split into separate component files for better code-splitting, tree-shaking, and maintainability.

### 11.3 Re-render cascading

- Realtime events trigger `fetchData()` which calls `Promise.all(...)` for ALL dashboard data, even if only one entity changed. This causes full state replacement and re-renders of all sub-components.
- **Recommendation:** Subscribe to specific entity changes and only refetch the affected data.

---

## Summary by Priority

### P0 — Critical (Fix before production)
1. **Zero pagination** on all lists/tables (§5.1)
2. **12 bare `confirm()` calls** for destructive/financial actions (§1.2)
3. **Brand payout CSV** built without injection protection (§7.2)
4. **"High Volume" badge** always shown for all agencies — misleading (§3.1 #6)
5. **Hardcoded statistics** (`+12%`, `+24%`, `Growing`) shown as real data (§3.1 #1-3)

### P1 — High (Fix soon)
6. **60+ `as any` casts** — many casting to types that already exist (§2.1)
7. **10+ `<img>` tags missing `alt`** — accessibility violation (§1.1)
8. **No `onError` fallback** on most `<img>` tags (§5.5)
9. **Inconsistent realtime debounce** timers (400/600/900ms) (§7.1)
10. **Missing `formatErrorMessage()`** usage in several files (§7.4)
11. **ColSpan mismatch** in AdminPortal orders table (§5.2)
12. **No focus trap / aria-modal** on any modal (§1.3)

### P2 — Medium (Improvement)
13. **Audit trail on-demand only**, not visible by default (§9.1-9.2)
14. **8/many audit actions filtered out** in display (§9.3)
15. **Bank details UI** declared but not implemented (§8.1)
16. **No forgot-password flow** (§8.5)
17. **External grainy-gradients.vercel.app dependency** (§10.2)
18. **Large monolithic component files** (§11.2)
19. **Currency formatting inconsistency** (§7.3)
20. **Hardcoded categories** in Explore (§8.4)

### P3 — Low (Cleanup)
21. **Unused state variables** (`_orderAuditEvents`, `setDetailView`) (§6.2)
22. **`parseInt` vs `Number`** inconsistency (§5.4)
23. **Clipboard writes without error handling** (§10.1)
24. **No offline banner** on dashboards (§8.6)
25. **Admin system health** shows fake status (§8.2)
