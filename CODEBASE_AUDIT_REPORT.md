# MOBO Codebase Audit Report

> **Generated:** Read-only analysis of 5 portals + shared + backend  
> **Scope:** Orders.tsx, MediatorDashboard.tsx, AgencyDashboard.tsx, BrandDashboard.tsx, AdminPortal.tsx, shared/services, shared/context, shared/hooks, shared/components, backend/controllers, backend/middleware, backend/services

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 High | 3 |
| 🟡 Medium | 15 |
| 🟢 Low | 14 |
| ℹ️ Info (Code Quality) | 5 |
| **Total** | **37** |

---

## 1. Silent / Empty Catch Blocks

### 1.1 — Frontend `catch {}` Blocks (User-Facing)

| # | File | Line | Severity | Description | Suggested Fix |
|---|------|------|----------|-------------|---------------|
| 1 | `shared/pages/Orders.tsx` | 699 | 🟢 Low | `submitTicket` catch block has no error variable but **does** call `toast.error('Failed to raise ticket.')`. Acceptable but loses error detail. | Add `(err)` and log: `catch (err) { console.error(err); toast.error(...); }` |
| 2 | `shared/pages/AgencyDashboard.tsx` | 211 | 🟢 Low | `handleSave` (profile update) catch block has no error variable but **does** call `toast.error('Failed to update profile.')`. | Add `(err)` to capture error for debugging. |
| 3 | `shared/pages/AgencyDashboard.tsx` | 482 | 🟢 Low | `handleUpdate` (ledger) catch block — same pattern, `toast.error('Update failed')` but no error variable. | Add `(err)` parameter. |
| 4 | `shared/pages/BrandDashboard.tsx` | 1457 | 🟢 Low | `handleToggleStatus` catch — `toast.error('Failed to update campaign status')` but error variable swallowed. | Add `(err)` parameter. |
| 5 | `shared/pages/BrandDashboard.tsx` | 1493 | 🟢 Low | `handleCreate` (campaign) catch — `toast.error('Failed to save campaign')` but error variable swallowed. Server-provided error messages (e.g. validation failures) are lost. | `catch (err) { const msg = err instanceof Error ? err.message : '...'; toast.error(msg); }` |

### 1.2 — Acceptable / Intentional Catch Blocks (No Action Needed)

The following use bare `catch {}` but are correct by design:

- **`shared/services/api.ts`** — Lines 15, 46, 56, 66, 79, 104: Storage/JSON parsing resilience. ✅
- **`shared/services/realtime.ts`** — 11 instances: SSE stream resilience (must not crash on parse errors). ✅
- **`shared/context/AuthContext.tsx`** — `try { localStorage.setItem(...) } catch {}`: Storage-full guard. ✅
- **`shared/context/ChatContext.tsx`** — `loadMessages` / `persistMessages`: sessionStorage resilience. ✅
- **`shared/pages/Orders.tsx`** Line 154 — URL validation `try { new URL(...) } catch { return false; }` ✅
- **`shared/pages/Orders.tsx`** Line 1269, **MediatorDashboard.tsx** Line 2327, **BrandDashboard.tsx** Line 1315, **AgencyDashboard.tsx** Line 3392 — Audit log loading catch blocks all call `toast.error(...)`. ✅
- **`backend/controllers/ordersController.ts`** ~Line 87 — `sendProofResponse` fallback that throws `AppError`. ✅
- **`backend/services/orderWorkflow.ts`** — Push notification `.catch()`: intentional non-critical. ✅

---

## 2. Missing Loading / Error States

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| 6 | `shared/pages/AdminPortal.tsx` | 329–400 | 🔴 High | `fetchAllData` uses individual `Promise.allSettled` handlers that only `console.error` on rejection — **no toast or UI indication**. User sees stale/empty data without knowing a fetch failed. 14+ catch blocks in this file log to console only. | Add `toast.error('Some data failed to load')` or a banner when any sub-fetch rejects. |
| 7 | `shared/pages/AdminPortal.tsx` | 230, 253, 276 | 🟡 Medium | Individual data refresh calls (audit, AI config, etc.) catch with only `console.error(e)`. User gets no feedback on failure. | Add toast notification per failed fetch, or a consolidated "partial data" banner. |
| 8 | `shared/pages/BrandDashboard.tsx` | 2549, 2579 | 🟡 Medium | `handleDecline` / `handleApprove` (connection requests) catch blocks use `console.error('Failed to decline/approve', e)` + `toast.error(...)`. The `toast.error` IS present, so this is acceptable — just verify the error message extraction. | Already has toast — OK. But error variable `e` should use `e instanceof Error ? e.message : '...'` pattern. |
| 9 | `shared/pages/Orders.tsx` | 264, 284, 296 | 🟡 Medium | Product loading, ticket loading, and initial data loading errors log to console; verify each has a corresponding toast or empty-state indicator. | Ensure every catch path either calls `toast.error()` or sets an `error` state that renders in the UI. |

---

## 3. SSR / `localStorage` / `window` Access Without Guards

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| 10 | `shared/context/AuthContext.tsx` | ~175–177 | 🟡 Medium | `logout()` calls `localStorage.removeItem('mobo_session')` and `localStorage.removeItem('mobo_tokens_v1')` **directly** without `typeof window !== 'undefined'` guard. Will crash during SSR (Next.js server render). | Wrap in `if (typeof window !== 'undefined') { ... }` or use the existing `canUseStorage()` helper from `api.ts`. |
| 11 | `shared/context/ChatContext.tsx` | 25–46 | 🟡 Medium | `loadMessages()` and `persistMessages()` access `sessionStorage` directly. While the `try/catch` prevents crashes, the call still executes during SSR and relies on the exception path. | Add explicit `if (typeof window === 'undefined') return [];` guard at the top of each function. |
| 12 | `shared/pages/MediatorDashboard.tsx` | 89–91 | 🟡 Medium | `urlToBase64()` references `window.location.origin` without SSR guard. Called from `useEffect` (client-only), so currently safe in practice, but fragile if refactored. | Add `if (typeof window === 'undefined') return '';` at the top of the function. |
| 13 | `shared/pages/AgencyDashboard.tsx` | 88–90 | 🟡 Medium | Identical `urlToBase64()` SSR risk as MediatorDashboard. | Same fix as #12. |
| 14 | `shared/components/ErrorBoundary.tsx` | 30 | 🟢 Low | `window.location.reload()` is called from a click handler (client-only) so safe in practice, but no guard. | No action needed — click handlers are inherently client-only. |
| 15 | `shared/utils/apiBaseUrl.ts` | 68, 84 | ✅ OK | `window.location.hostname` and `window.location.origin` are properly guarded by `typeof window !== 'undefined'` check. | No action needed. |
| 16 | `shared/services/realtime.ts` | 44, 53–55 | ✅ OK | All `window` / `localStorage` access properly guarded. | No action needed. |
| 17 | `shared/context/CartContext.tsx` | 26, 38 | ✅ OK | Uses `typeof window === 'undefined'` guard before accessing `localStorage`. | No action needed. |

---

## 4. Missing Form Validation

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| 18 | `shared/pages/BrandDashboard.tsx` | ~1493 | 🟡 Medium | `handleCreate` (campaign creation) relies on HTML `required` attributes and `type="url"` for client-side validation, but the `catch` block only shows generic "Failed to save campaign" — it should propagate server validation error messages. | Extract error message: `catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save campaign'); }` |
| 19 | `shared/pages/MediatorDashboard.tsx` | Deal builder modal (~L2790) | 🟢 Low | Commission input allows any integer (including very large negative values). No max/min boundary on the commission field. | Add `min`/`max` attributes or validation logic to prevent unreasonable commission values (e.g., commission > price). |
| 20 | `shared/pages/BrandDashboard.tsx` | Agency payment modal (~L2710) | 🟢 Low | Payout amount input has `type="number"` and checks `> 0` but no maximum limit in the modal itself. The backend enforces ₹10,00,000 max but the UI doesn't show this constraint. | Add `max` attribute or validation message: "Maximum ₹10,00,000 per transaction". |

**Positive findings:** Backend validation is comprehensive — Zod schemas validate all inputs, velocity limits prevent abuse, and the order creation flow has multi-layer validation (campaign access, slot checks, AI verification, duplicate detection).

---

## 5. Edge Cases

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| 21 | `shared/pages/Orders.tsx` | ~767 | 🟡 Medium | CSV export creates `Blob([csv])` **without BOM prefix** (`\uFEFF`). Excel may misinterpret UTF-8 characters (₹ symbol, Hindi text). AgencyDashboard (L580) and AdminPortal (L665) correctly include BOM. | Change to `new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })` |
| 22 | `shared/pages/BrandDashboard.tsx` | ~785 | 🟡 Medium | `handleExportOrders` CSV — same missing BOM issue. | Same fix as #21. |
| 23 | `shared/pages/BrandDashboard.tsx` | ~2131 | 🟡 Medium | `handleExportPayouts` CSV — same missing BOM issue. | Same fix as #21. |
| 24 | `shared/pages/Orders.tsx` | ~767 | 🟢 Low | CSV export lacks `csvSafe()` formula injection prevention. BrandDashboard and AdminPortal have a `csvSafe()` function that strips leading `=`, `+`, `-`, `@` characters. Orders.tsx does quote values with `"` but doesn't strip formula characters. | Add `csvSafe()` helper or import from shared utils. |
| 25 | `backend/controllers/ordersController.ts` | ~580–590 | 🟢 Low | `createOrder` calls `writeAuditLog` **twice** — once before `res.status(201).json(...)` and once after. The first call (L~575) and second call (L~600) both log `ORDER_CREATED` with slightly different metadata. | Remove the duplicate audit log call. Keep only the post-response one (with full metadata). |

---

## 6. Hardcoded API URLs

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| — | — | — | ✅ None Found | All API URLs resolve through `getApiBaseUrl()` in `shared/utils/apiBaseUrl.ts`. The localhost fallback (`http://localhost:8080/api`) is **runtime-gated** behind `window.location.hostname === 'localhost'` check. No hardcoded production URLs exist. | No action needed. |

---

## 7. TODO / FIXME / HACK Comments

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| — | — | — | ✅ None Found | Grep for `TODO|FIXME|HACK` across all `.ts` and `.tsx` files found zero actual code comments. All matches were false positives (variable names like `todo`, UI placeholder text, AI prompt examples). | No action needed. |

---

## 8. Accessibility Issues

| # | File | Line(s) | Severity | Description | Suggested Fix |
|---|------|---------|----------|-------------|---------------|
| 26 | All 5 portal pages | — | 🔴 High | **No `aria-live` regions anywhere** in any portal. Dynamic content updates (order status changes, toast-like notifications, data refreshes, realtime updates) are invisible to screen readers. The ToastContext uses `role="status"` and `aria-live="polite"` on the toast container, but the portal pages themselves have no live regions for their main content areas. | Add `aria-live="polite"` regions around dynamic content: order lists, verification modals, notification badges. |
| 27 | `shared/pages/AdminPortal.tsx` | Entire page | 🟡 Medium | Admin portal modals (delete confirmations) use `window.confirm()` (L461, 478, 494, 526, 545) which is accessible by default. Good. However, close buttons on modals lack `aria-label`. | Add `aria-label="Close"` to modal close buttons. |
| 28 | `shared/pages/BrandDashboard.tsx` | Agency detail modal (~L2640) | 🟡 Medium | Modal close button has no `aria-label`. The "Disconnect agency" trash button has no accessible label. | Add `aria-label="Close"` and `aria-label="Disconnect agency"` respectively. |
| 29 | `shared/pages/AgencyDashboard.tsx` | Team view & modals | 🟡 Medium | Several close buttons lack `aria-label`. Approval/rejection buttons in requests tab have no accessible labels (just icons). | Add `aria-label` attributes to icon-only buttons. |
| 30 | `shared/pages/MediatorDashboard.tsx` | Reject modal (~L2650) | 🟢 Low | Reject modal close button has no `aria-label` (just `<X size={16} />`). | Add `aria-label="Close reject modal"`. |
| 31 | `shared/components/DesktopShell.tsx` | ~49 | 🟢 Low | Sidebar overlay `<div>` that closes sidebar on click has no keyboard equivalent. Cannot be closed via Escape key. | Add `onKeyDown` handler for Escape, or use a `<dialog>` element. |

**Positive findings:**
- Orders.tsx has excellent accessibility: `aria-label` on all close buttons, `focus-visible` rings, `motion-reduce:animate-none` for reduced motion.
- MediatorDashboard.tsx uses `aria-pressed` on toggle buttons, `aria-label` on notification/close buttons.
- BrandDashboard.tsx and AgencyDashboard.tsx use `aria-current="page"` on sidebar navigation items.
- Explore.tsx uses `aria-pressed` on category filter buttons and `aria-label` on search input.
- Profile.tsx has `aria-label` on edit/save and avatar change buttons.

---

## 9. Code Duplication (Info)

| # | File(s) | Severity | Description | Suggested Fix |
|---|---------|----------|-------------|---------------|
| 32 | Orders.tsx, MediatorDashboard.tsx, BrandDashboard.tsx, AgencyDashboard.tsx | ℹ️ Info | `formatCurrency()` is duplicated identically in 4+ files. | Extract to `shared/utils/formatCurrency.ts`. |
| 33 | Orders.tsx, MediatorDashboard.tsx, BrandDashboard.tsx, AgencyDashboard.tsx | ℹ️ Info | `getPrimaryOrderId()` is duplicated identically in 4+ files. | Extract to `shared/utils/orderHelpers.ts`. |
| 34 | MediatorDashboard.tsx, AgencyDashboard.tsx | ℹ️ Info | `urlToBase64()` is duplicated identically (with same SSR issue). | Extract to `shared/utils/imageHelpers.ts` with proper SSR guard. |
| 35 | BrandDashboard.tsx, AdminPortal.tsx, AgencyDashboard.tsx | ℹ️ Info | `csvSafe()` formula injection prevention function is duplicated but **not present** in Orders.tsx or BrandDashboard payout export. | Extract to `shared/utils/csvHelpers.ts` and use consistently in all exports. |
| 36 | Multiple portals | ℹ️ Info | CSV export logic (Blob creation, download link, cleanup) is copy-pasted across 5+ locations with inconsistent BOM handling. | Create a shared `downloadCsv(filename, csvString)` utility. |

---

## 10. Backend Observations (Positive)

These areas were reviewed and found to be well-implemented:

| Area | Assessment |
|------|------------|
| **Auth middleware** (`backend/middleware/auth.ts`) | ✅ Zero-trust JWT auth — roles always re-verified from DB. Upstream suspension enforcement (buyer→mediator→agency chain). |
| **Error middleware** (`backend/middleware/errors.ts`) | ✅ Comprehensive: handles AppError, ZodError, CastError, SyntaxError, entity.too.large. Request ID in all responses. Production mode hides internal details. |
| **Order workflow** (`backend/services/orderWorkflow.ts`) | ✅ Explicit state machine with ALLOWED transitions map. Frozen order protection. Optimistic state check via `findOneAndUpdate`. |
| **Wallet service** (`backend/services/walletService.ts`) | ✅ Idempotent credit/debit with MongoDB transactions. Max balance safety limit (₹1,00,000). Optimistic locking for debits. |
| **Auth controller** (`backend/controllers/authController.ts`) | ✅ Account lockout (7 attempts → 15min lock). Transaction-based registration with atomic invite consumption. Admin username-only login enforcement. |
| **Orders controller** (`backend/controllers/ordersController.ts`) | ✅ Velocity limits (10/hr, 30/day). Duplicate detection. Multi-step AI proof verification. Role-based proof access control. Step-gating (purchase must be verified before rating/review upload). |
| **Realtime service** (`shared/services/realtime.ts`) | ✅ SSR-safe. Exponential backoff (1s–12s) with jitter. 70s idle reconnect. Cross-tab auth sync. |
| **API base URL** (`shared/utils/apiBaseUrl.ts`) | ✅ Cascading env-var resolution with SSR guards. Localhost fallback properly gated. |

---

## Priority Remediation Order

1. **🔴 #26** — Add `aria-live` regions for dynamic content (accessibility compliance)
2. **🔴 #6** — AdminPortal silent data fetch failures (users see empty/stale data)
3. **🟡 #10** — AuthContext SSR `localStorage` access (crashes Next.js SSR)
4. **🟡 #21–23** — CSV BOM consistency (broken Excel display for non-ASCII)
5. **🟡 #11–13** — ChatContext and urlToBase64 SSR guards
6. **🟡 #27–29** — Modal accessibility (aria-labels on close/action buttons)
7. **🟢 #1–5** — Add error variables to catch blocks for debugging
8. **🟢 #24–25** — CSV formula injection prevention and duplicate audit log
9. **ℹ️ #32–36** — Extract duplicated utilities to shared module

---

*This report is read-only analysis. No files were modified.*
