# AI Extraction System — Complete Code Audit

> **Generated**: June 2025  
> **Scope**: Every AI-related file in the MOBO codebase — services, routes, tests, scripts, frontend API bindings  
> **Method**: Every line of every file was read and analysed

---

## Table of Contents

1. [File Inventory](#1-file-inventory)
2. [Architecture Overview](#2-architecture-overview)
3. [File-by-File Breakdown](#3-file-by-file-breakdown)
4. [Identified Bugs & Issues](#4-identified-bugs--issues)
5. [Security Concerns](#5-security-concerns)
6. [Performance Concerns](#6-performance-concerns)
7. [Test Coverage Assessment](#7-test-coverage-assessment)
8. [Recommendations](#8-recommendations)

---

## 1. File Inventory

| # | File | Lines | Role |
|---|------|-------|------|
| 1 | `backend/services/aiService.ts` | 3398 | **Core AI engine** — all Gemini, Tesseract, extraction, verification logic |
| 2 | `backend/routes/aiRoutes.ts` | 684 | **Express router** — 6 endpoints, rate limiting, validation, smart chat routing |
| 3 | `backend/tests/ai.spec.ts` | ~130 | Unit tests for `generateChatUiResponse` and `verifyProofWithAi` |
| 4 | `backend/tests/ai.routes.spec.ts` | ~120 | Integration tests for the AI route handlers |
| 5 | `backend/tests/extraction.spec.ts` | ~490 | **22 test cases** for `extractOrderDetailsWithAi` — platform-specific & edge cases |
| 6 | `backend/scripts/test-extraction-logic.ts` | ~60 | Quick regex confirmation script (not part of test suite) |
| 7 | `scripts/check-ai-key.ps1` | 5 | PowerShell wrapper calling `npm --prefix backend run ai:check` |
| 8 | `shared/services/api.ts` (AI sections) | ~80 | Frontend API bindings for `/ai/*` endpoints |
| 9 | `shared/components/AppSwitchboard.tsx` | 1 ref | UI copy: "Gemini 3.0 Pro Active" (cosmetic, incorrect model name) |
| 10 | `shared/package.json` | 1 ref | `@google/genai: ^1.31.0` dependency declared (but **no** shared AI service file exists) |

**Deleted/Missing file**: `shared/services/geminiService.ts` — referenced in `eslint-report.json` (from old path `f:\MOBO-main`) but **does not exist** in the current workspace. The dependency `@google/genai` in `shared/package.json` is therefore **unused**.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (shared/)                       │
│  api.orders.extractDetails()  ──► POST /ai/extract-order    │
│  api.orders.verifyRating()    ──► POST /ai/verify-rating    │
│  api.chat.sendMessage()       ──► POST /ai/chat             │
│  api.ops.analyzeProof()       ──► POST /ai/verify-proof     │
│  api.ai.chat()                ──► POST /ai/chat  (duplicate)│
│  api.ai.verifyProof()         ──► POST /ai/verify-proof     │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────────────┐
│               aiRoutes.ts (Express Router)                   │
│  Rate limiters → Auth → Zod validation → Service calls       │
│  Smart chat routing (keyword match before Gemini)            │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                aiService.ts (3398 lines)                      │
│                                                              │
│  ┌──────────────────┐    ┌────────────────────┐             │
│  │  Google Gemini    │    │  Tesseract.js OCR  │             │
│  │  (Primary AI)     │    │  (Fallback/Local)  │             │
│  │  5-model fallback │    │  Worker pool (2)   │             │
│  │  Circuit breaker  │    │  Sharp preprocess  │             │
│  └────────┬─────────┘    └────────┬───────────┘             │
│           │                       │                          │
│  ┌────────▼───────────────────────▼───────────┐             │
│  │           Deterministic Regex Engine        │             │
│  │  20+ platform order ID patterns             │             │
│  │  Amount extraction with label priority       │             │
│  │  Product name extraction (platform-aware)    │             │
│  │  Platform detection with OCR confusion       │             │
│  │  Post-processing sanity checks (8+ rules)   │             │
│  └────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────┘
```

### Processing Pipeline (extractOrderDetailsWithAi)

1. **Input**: Base64-encoded image (data URL)
2. **Multi-device crop**: 4–8 crop variants per device category (desktop/tablet/phone)
3. **OCR preprocessing**: 4 Sharp modes per crop (greyscale, normalize+sharpen, high-contrast, inverted)
4. **Tesseract OCR**: Worker pool → text extraction for every variant
5. **Regex extraction**: Order ID, amount, platform, product name — per-variant scoring, best result kept
6. **AI refinement** (if Gemini configured & OCR score < 90):
   - Step 1: Send OCR text to Gemini for structured refinement
   - Step 2: If step 1 fails, send raw image to Gemini for direct extraction
7. **Post-processing sanity checks**: 8+ rules filtering bad product names, impossible amounts, etc.
8. **Return**: `{ orderId, amount, platform, productName, confidenceScore, notes }`

---

## 3. File-by-File Breakdown

### 3.1. `backend/services/aiService.ts` (3398 lines)

The monolithic AI engine. Every AI function lives here.

#### Sections

| Lines | Component | Description |
|-------|-----------|-------------|
| 1–30 | Imports & setup | `@google/genai`, `tesseract.js`, `sharp`, types |
| 30–58 | Circuit breaker | `isGeminiCircuitOpen()`, `recordGeminiSuccess()`, `recordGeminiFailure()` — threshold 3 consecutive failures, 300s cooldown |
| 59–82 | Confidence constants | `OCR_BASE: 30`, `OCR_ORDER_ID_BONUS: 30`, `OCR_AMOUNT_BONUS: 25`, `OCR_MAX_CAP: 85`, etc. |
| 83–130 | OCR worker pool | `acquireOcrWorker()` / `releaseOcrWorker()`, pool size 2, `process.on('beforeExit')` cleanup |
| 131–200 | Utility functions | `isGeminiConfigured()`, `checkGeminiApiKey()`, `initAiServiceConfig()`, Sharp preprocessing (`preprocessForOcr`) with 4 modes |
| 200–246 | callGeminiWithFallback | 5-model cascade (`gemini-2.5-flash` → `2.0-flash` → `2.0-flash-001` → `2.0-flash-exp` → `2.5-pro`), JSON extraction, retry on parse failure |
| 247–266 | Prompt injection guard | `containsPromptInjection()` — 9 regex patterns, `stripUnsafeContent()`, `sanitizeUserMessage()`, `sanitizeHistory()` |
| 268–390 | Token/text utilities | `estimateTokensFromText()`, `estimateTokensFromImage()`, text truncation, budget calculations |
| 390–650 | Chat system | `generateChatUiResponse()` — system prompt with deal search, JSON response schema, image analysis, model fallback chain |
| 650–695 | OCR helpers | `runOcrOnImage()` — calls Tesseract on preprocessed buffers, high-contrast fallback if text < 30 chars |
| 695–870 | Proof verification (OCR) | `verifyProofWithOcr()` — digit confusion normalization (`O→0`, `I→1`, `S→5`), amount tolerance (±₹2 or ±0.5%), Indian comma parsing |
| 871–990 | Proof verification (AI) | `verifyProofWithAi()` — Gemini-first + OCR fallback, "GOD-LEVEL ACCURACY" prompt |
| 991–1000 | Rating OCR helper types | Internal types for rating verification |
| 1000–1180 | Rating OCR verification | `verifyRatingWithOcr()` — multi-device crop variants (landscape/tablet/phone), fuzzy name matching, stop word filtering |
| 1182–1290 | Rating AI verification | `verifyRatingScreenshotWithAi()` — Gemini-first with detailed prompt, OCR fallback |
| 1300–1425 | Return window OCR | `verifyReturnWindowWithOcr()` — checks order ID, product name, amount, "sold by", return window status |
| 1426–1505 | Return window AI | `verifyReturnWindowWithAi()` — Gemini-first, OCR fallback |
| 1507–1640 | Order extraction: regex patterns | 20+ platform order ID regexes (Amazon, Flipkart, Myntra, Meesho, AJIO, JIO, Nykaa, Tata, Snapdeal, BigBasket, 1MG, Croma, Purplle, Shopsy, Blinkit, Zepto, Lenskart, PharmEasy, Swiggy) |
| 1640–1700 | Order extraction: order ID matching | `extractOrderId()` — iterates ordered patterns, OCR confusion fixup |
| 1700–1870 | Order extraction: amount parsing | Label priority (FINAL/Total/Amount Paid > Grand Total > general), MRP/discount exclusion, Indian comma format, bare number fallback with date/phone/pincode rejection |
| 1870–1910 | Platform detection | `detectPlatform()` — domain/branding match with OCR confusion variants |
| 1910–2190 | Product name extraction | Platform-aware strategies (Amazon: between order info and "Sold by"; Flipkart: after OD+delivery; Myntra: brand+type; Meesho: after delivery/shipped; Nykaa: beauty keywords; grocery: food/quantity), generic scoring fallback with 40+ exclude patterns |
| 2190–2250 | OCR prefix fixup | `fixOcrPrefixes()` for common OCR confusions (`0D→OD`, `MEESH0→MEESHO`, etc.) |
| 2250–2560 | Multi-pass OCR extraction | For each crop variant: preprocess → OCR → regex extract → score → accumulate best |
| 2560–2750 | Crop variant generation | Desktop (8 variants), tablet portrait (6), tablet landscape (4), phone (7) — all via Sharp |
| 2750–2870 | Parallel OCR execution | `Promise.all` on crop variants with Sharp preprocessing modes |
| 2870–3050 | Result accumulation | Best-scored results across OCR passes, combined text fallback, "accumulated" notes |
| 3050–3180 | AI refinement | Two-step: (1) text-based Gemini refinement, (2) direct image Gemini extraction fallback. Guards: order ID digit ≠ amount |
| 3180–3240 | Confidence calculation | OCR base + bonuses for order ID/amount/platform/product, capped at 85 for OCR-only |
| 3240–3398 | Post-processing sanity checks | 8 rules: amount-from-orderID, URL product names, unreasonable amounts (>₹500K), date-like amounts, delivery status names, category lists (3+ commas), addresses (Indian city/state keywords), platform-only names, phone/tracking numbers |

#### Exported Functions

| Function | Purpose |
|----------|---------|
| `isGeminiConfigured(env)` | Returns boolean — checks `GEMINI_API_KEY` in env |
| `checkGeminiApiKey(env)` | Live API key validation (sends test prompt to Gemini) |
| `initAiServiceConfig(env)` | Eagerly initializes Tesseract workers if `AI_EAGER_INIT` is set |
| `generateChatUiResponse(env, payload)` | AI chatbot — handles text+image messages |
| `verifyProofWithAi(env, payload)` | Purchase proof verification (order ID + amount matching) |
| `verifyRatingScreenshotWithAi(env, payload)` | Rating screenshot verification (name + product matching) |
| `verifyReturnWindowWithAi(env, payload)` | Return window closure verification |
| `extractOrderDetailsWithAi(env, payload)` | **Main extraction engine** — OCR + AI pipeline |

---

### 3.2. `backend/routes/aiRoutes.ts` (684 lines)

#### Endpoints

| Method | Path | Auth | Rate Limit | Description |
|--------|------|------|------------|-------------|
| `POST` | `/chat` | Optional | 10/min auth, 5/min anon + 50/day | AI chatbot with smart keyword routing |
| `GET` | `/status` | None | 20/min | Returns `{ geminiConfigured, model }` |
| `POST` | `/check-key` | Required (admin/ops) | 5/min | Live Gemini API key test |
| `POST` | `/verify-proof` | Required | 10/min + 100/day | Purchase proof verification |
| `POST` | `/verify-rating` | Required | 10/min + 100/day | Rating screenshot verification |
| `POST` | `/extract-order` | Required | 15/min + 200/day | Order details extraction |

#### Smart Chat Routing (Lines 270–490)

Before calling Gemini, the chat route checks for keyword patterns and returns local responses:
- **Deal search**: `show.*deals`, `find.*product`, `search.*for` → queries DB for mediator's deals
- **Order status**: `order.*status`, `where.*order`, `track.*order` → returns from `orders` array in payload
- **Ticket status**: `ticket.*status`, `support.*ticket` → returns from `tickets` array
- **Navigation**: `how.*navigate`, `where.*find`, `go to` → returns static navigation help
- **System info**: `what.*version`, `app.*info` → returns app metadata

Only complex/unmatched queries proceed to Gemini.

#### Daily Limits (In-Memory)

Per-user daily limits tracked via `Map<string, { count, resetAt }>`:
- Chat: 50/day
- Verify proof: 100/day
- Verify rating: 100/day
- Extract order: 200/day

Hourly purge via `setInterval(..., 3_600_000)`.

---

### 3.3. `backend/tests/extraction.spec.ts` (~490 lines)

**22 test cases** covering:

| Test | Platform | Validates |
|------|----------|-----------|
| Amazon order ID + amount | Amazon | 3-7-7 pattern, ₹522 |
| Flipkart order ID | Flipkart | OD prefix with OCR `O/0` tolerance |
| Blank image | — | Low confidence (≤30) |
| Large phone screenshot | Amazon | No "too large" rejection, order ID + amount |
| Meesho order ID + amount | Meesho | MEESHO prefix, ₹349 |
| Myntra order ID | Myntra | MYN prefix, ₹2499 |
| Desktop wide screenshot | Amazon | 1920px wide, Amount Paid label |
| Indian comma + Amount Paid priority | Amazon | ₹29,999 chosen over ₹45,999 MRP |
| Amazon product name | Amazon | Samsung extracted, no URL/delivery status |
| Nykaa product name | Nykaa | NYK prefix, Lakme product |
| Blinkit grocery | Blinkit | BLK prefix, Amul product |
| AJIO fashion | AJIO | FN prefix, Polo/shirt product |
| URL rejection | — | Product name ≠ https://... |
| Delivery status rejection | — | Product name ≠ "Arriving on..." |
| Category list rejection | — | Product name ≠ comma-separated list |
| Meesho product name | Meesho | Kurti/Anarkali extracted |
| Address rejection | — | Product name ≠ Koramangala/Bangalore |

All tests use **Tesseract-only mode** (GEMINI_API_KEY = '' forces fallback). Tests render text onto images via Sharp SVG overlay.

---

### 3.4. `backend/tests/ai.spec.ts` (~130 lines)

| Test | What it validates |
|------|-------------------|
| Chat without API key | Throws error |
| Greeting intent | Returns greeting response |
| Search intent | Returns search/product response |
| Empty message | Throws validation error |
| Proof verify (no key) | Falls back to OCR, returns structured result |
| Proof verify (with key) | Returns structured `{ isValid, confidenceScore, reason }` |
| Invalid base64 | Throws error |

---

### 3.5. `backend/tests/ai.routes.spec.ts` (~120 lines)

| Test | What it validates |
|------|-------------------|
| GET /status | Returns `{ geminiConfigured }` |
| Invalid token | 401 rejection |
| Missing payload fields | 400 validation error |
| No Gemini key | 503 for chat |
| POST /verify-proof validation | 400 on missing fields |
| POST /extract-order validation | 200 (Tesseract fallback, not 503) |

---

### 3.6. `backend/scripts/test-extraction-logic.ts` (~60 lines)

Standalone confirmation script. Hardcodes Amazon OCR text and runs regex patterns against it. **Not part of the test suite** — purely for manual developer verification. Prints `1000% MATCH` if regex finds the expected ID and amount.

---

### 3.7. `scripts/check-ai-key.ps1` (5 lines)

```powershell
npm --prefix backend run ai:check
```

Delegates to `backend` npm script `ai:check` which calls `checkGeminiApiKey()`.

---

### 3.8. `shared/services/api.ts` (AI sections)

Frontend API bindings calling the backend AI endpoints:

| Client Method | Endpoint | Used By |
|---------------|----------|---------|
| `api.orders.extractDetails(file)` | `POST /ai/extract-order` | Orders.tsx |
| `api.orders.verifyRating(file, ...)` | `POST /ai/verify-rating` | Order proof flow |
| `api.chat.sendMessage(...)` | `POST /ai/chat` | Chatbot.tsx (9 args) |
| `api.ops.analyzeProof(...)` | `POST /ai/verify-proof` | Ops/mediator dashboard |
| `api.ai.chat(payload)` | `POST /ai/chat` | **Duplicate** of `api.chat` |
| `api.ai.verifyProof(payload)` | `POST /ai/verify-proof` | **Duplicate** of `api.ops` |

---

## 4. Identified Bugs & Issues

### BUG-01: "GOD-LEVEL ACCURACY" in Gemini prompts (Severity: Low)

**Location**: `backend/services/aiService.ts` — proof verification prompt, rating verification prompt, return window prompt  
**Problem**: The string `"GOD-LEVEL ACCURACY REQUIRED"` appears in multiple Gemini prompts. This is unprofessional for production, wastes tokens, and has zero effect on model accuracy.  
**Fix**: Remove the phrase entirely. Replace with concise, specific instructions.

---

### BUG-02: OCR confidence hard-capped at 85 (Severity: Medium)

**Location**: `backend/services/aiService.ts` — `CONFIDENCE.OCR_MAX_CAP = 85`  
**Problem**: Even when OCR produces a **perfect match** (correct order ID, correct amount, correct platform, correct product name), the confidence score can never exceed 85 without Gemini. This means:
- If Gemini is down (circuit breaker open) or unconfigured, a perfect OCR match still looks "uncertain" to downstream consumers.
- Any threshold > 85 in the order flow will never pass OCR-only.

**Impact**: Orders extracted via Tesseract-only always appear lower confidence than they should.  
**Fix**: Either raise the cap to 95, or use a separate `verified_by` field to distinguish OCR-vs-AI results rather than artificially capping scores.

---

### BUG-03: High-contrast fallback threshold too low (Severity: Medium)

**Location**: `backend/services/aiService.ts` — `runOcrOnImage()`, approximately line 670  
**Problem**: High-contrast preprocessing only triggers as a fallback when initial OCR returns fewer than 30 characters. However, OCR can produce 31+ characters of **garbage** (e.g., misread text, UI chrome, partial words) that pass this threshold, causing the high-contrast mode to be skipped entirely.  
**Fix**: Use a smarter heuristic — e.g., check if the text contains any valid order ID pattern or currency symbol, not just raw length.

---

### BUG-04: Tesseract PSM cast as `'6' as any` (Severity: Low)

**Location**: `backend/services/aiService.ts` — Tesseract `recognize()` call  
**Problem**: TypeScript typing for `tesseract.js` v7 doesn't accept string PSM values, so the code uses `'6' as any`. This is fragile and will break silently if Tesseract.js changes its API.  
**Fix**: Import the correct PSM enum type from tesseract.js or define a typed constant.

---

### BUG-05: Duplicate API bindings on the frontend (Severity: Low)

**Location**: `shared/services/api.ts`  
**Problem**: There are **two** chat bindings (`api.chat.sendMessage()` and `api.ai.chat()`) and **two** proof verification bindings (`api.ops.analyzeProof()` and `api.ai.verifyProof()`), both calling the same backend endpoints. The `api.chat.sendMessage()` takes 9 positional arguments which is error-prone.  
**Fix**: Consolidate to a single binding per endpoint. Use an options object instead of 9 positional args.

---

### BUG-06: Unused `@google/genai` dependency in `shared/package.json` (Severity: Low)

**Location**: `shared/package.json` line 12  
**Problem**: `@google/genai: ^1.31.0` is declared as a dependency, but the corresponding `shared/services/geminiService.ts` file **no longer exists**. No shared code imports `@google/genai`.  
**Fix**: Remove the dependency from `shared/package.json`.

---

### BUG-07: Incorrect model name in UI copy (Severity: Low)

**Location**: `shared/components/AppSwitchboard.tsx` line 83  
**Problem**: UI displays `"Gemini 3.0 Pro Active"` but the actual models used are `gemini-2.5-flash`, `gemini-2.0-flash`, and `gemini-2.5-pro`. "Gemini 3.0 Pro" does not exist.  
**Fix**: Update to reflect actual model name or make it dynamic from the `/ai/status` endpoint.

---

### BUG-08: Amount-from-order-ID false positives still possible (Severity: Medium)

**Location**: `backend/services/aiService.ts` — post-processing sanity checks, ~line 3250  
**Problem**: The sanity check for "amount is a contiguous substring of order ID digits" checks `orderIdDigits.includes(amountStr)`. For Amazon order IDs with 17 digits (e.g., `408-9652341-7203568`), common amounts like ₹134 or ₹52 are likely substrings. The check guards against this for short amounts (< 5 digits) but not for all cases.  
**Fix**: Consider only rejecting when the amount matches a suffix or prefix of the order ID, or when the amount has no label context.

---

### BUG-09: RegExp objects created inside hot loop (Severity: Low/Performance)

**Location**: `backend/services/aiService.ts` — `extractOrderDetailsWithAi()` inner extraction loop  
**Problem**: Multiple `new RegExp(...)` calls with identical patterns are created on every invocation. These should be module-level `const` patterns compiled once.  
**Fix**: Move all regex pattern definitions to module scope (some already are at lines 1540–1640, but amount/product patterns inside functions are re-compiled).

---

### BUG-10: `test-extraction-logic.ts` is dead code (Severity: Low)

**Location**: `backend/scripts/test-extraction-logic.ts`  
**Problem**: This file is a standalone script that duplicates logic already tested in `extraction.spec.ts`. It prints `"1000% MATCH"` which is unprofessional. It's not referenced in any npm script or CI pipeline.  
**Fix**: Delete the file.

---

## 5. Security Concerns

### SEC-01: Low proof rejection threshold (60) (Severity: High)

**Location**: `backend/routes/aiRoutes.ts` — `verify-proof` handler  
**Problem**: Confidence scores ≥ 60 cause proof to be accepted. With OCR-only giving base 30 + order ID bonus 30 = 60, a screenshot containing **only the order ID** (no amount, no product) passes verification.  
**Fix**: Raise threshold to 75+ or require both order ID AND amount to be verified.

---

### SEC-02: Prompt injection detection is basic (Severity: Medium)

**Location**: `backend/services/aiService.ts` lines 247–266  
**Problem**: 9 regex patterns check for injection phrases like `"ignore previous"`, `"system prompt"`, `"you are now"`. These are easily bypassed with:
- Unicode homoglyphs (`іgnore` with Cyrillic `і`)
- Base64-encoded instructions in image metadata
- Multi-language prompts (`ignora las instrucciones anteriores`)  
**Fix**: Add homoglyph normalization, multilingual patterns, and image metadata stripping.

---

### SEC-03: Error message leakage from Gemini failures (Severity: Medium)

**Location**: `backend/services/aiService.ts` — `callGeminiWithFallback()` catch blocks  
**Problem**: When Gemini throws, the error message is propagated to the response. Google API errors can contain partial API key info, internal URLs, or quota details.  
**Fix**: Log the full error server-side but return a generic error to the client.

---

### SEC-04: In-memory rate limits reset on restart (Severity: Medium)

**Location**: `backend/routes/aiRoutes.ts` — daily limit Maps  
**Problem**: All per-user daily counters are stored in JavaScript `Map` objects. On server restart or deployment, all limits reset to zero. In multi-worker deployments (e.g. cluster mode), each worker has its own Map — a user can exceed limits by hitting different workers.  
**Fix**: Use Redis or the database for rate limit state.

---

### SEC-05: No user consent for AI data processing (Severity: Medium)

**Location**: `backend/routes/aiRoutes.ts` — chat endpoint  
**Problem**: User messages, order screenshots, and personal data (name, order history, images) are sent to Google Gemini with no explicit user consent or data processing notice. This may violate GDPR / India DPDP Act 2023 requirements.  
**Fix**: Add consent checkbox in chat UI, log consent, provide opt-out.

---

### SEC-06: E2E bypass mode in production-accessible code (Severity: Medium)

**Location**: `backend/routes/aiRoutes.ts` — `verify-proof` handler  
**Problem**: When `E2E_MODE` env var is set, the verify-proof endpoint returns a hardcoded success response without any actual verification. If this env var is accidentally set in production, all proof verification is bypassed.  
**Fix**: Guard E2E bypass with `NODE_ENV === 'test'` AND `E2E_MODE` together, or use a more explicit flag.

---

## 6. Performance Concerns

### PERF-01: Up to 32 OCR passes per extraction (Severity: High)

**Location**: `backend/services/aiService.ts` — crop variant generation + preprocessing  
**Problem**: For desktop images, the pipeline generates 8 crop variants × 4 preprocessing modes = **32 OCR passes**. Each pass involves Sharp image processing + Tesseract recognition. Even with a worker pool of 2, this creates significant latency (~10–45 seconds per extraction).  
**Impact**: Under load, Tesseract workers become a bottleneck. Memory usage spikes from holding 32 image buffers simultaneously.  
**Fix**: Reduce crop variants (use aspect-ratio heuristics to pick 2–3 relevant crops), or implement early termination when a high-confidence match is found.

---

### PERF-02: Worker pool size hardcoded to 2 (Severity: Medium)

**Location**: `backend/services/aiService.ts` — `POOL_SIZE = 2`  
**Problem**: On servers with 4–8 cores, only 2 Tesseract workers are available. On single-core servers, 2 workers contend for CPU.  
**Fix**: Make pool size configurable via env var (e.g., `AI_OCR_POOL_SIZE`) defaulting to `Math.max(1, os.cpus().length - 1)`.

---

### PERF-03: 5-model Gemini fallback cascade (Severity: Medium)

**Location**: `backend/services/aiService.ts` — `callGeminiWithFallback()`  
**Problem**: On failure, the system tries up to 5 different Gemini models sequentially. With network timeouts, worst case is 5× the timeout duration.  
**Fix**: Limit to 2–3 models. Use exponential backoff only on rate-limit (429) errors, not on all failures.

---

### PERF-04: No image size limit enforcement (Severity: Medium)

**Location**: `backend/routes/aiRoutes.ts` — `extract-order` handler  
**Problem**: The Zod schema validates `imageBase64` is a string but doesn't enforce a maximum length. A 20MB screenshot base64-encoded to ~27MB will be processed, consuming memory and Tesseract time.  
**Fix**: Add `z.string().max(10_000_000)` (accepting up to ~7.5MB images) or resize before OCR.

---

## 7. Test Coverage Assessment

### What's Well-Tested

- **22 extraction tests** covering 7 platforms (Amazon, Flipkart, Myntra, Meesho, Nykaa, Blinkit, AJIO)
- **Edge cases**: blank images, URL rejection, delivery status rejection, category list rejection, address rejection, Indian comma formatting, Amount Paid priority over MRP
- **Multi-device**: desktop wide screenshot (1920px), phone-sized image (1080px)
- **Tesseract fallback**: All extraction tests run without Gemini key

### What's NOT Tested

| Gap | Severity |
|-----|----------|
| Circuit breaker behavior (3 failures → open → recovery) | High |
| Gemini model fallback chain (mock Gemini, fail primary, verify secondary is tried) | High |
| Concurrent extraction requests (worker pool exhaustion) | High |
| Rate limiter enforcement (daily limits, per-user tracking) | Medium |
| Prompt injection detection (`containsPromptInjection()`) | Medium |
| Rating verification OCR (`verifyRatingWithOcr()`) | Medium |
| Return window verification OCR (`verifyReturnWindowWithOcr()`) | Medium |
| Smart chat routing (keyword matching in aiRoutes) | Medium |
| Token estimation accuracy | Low |
| OCR prefix fixup (`fixOcrPrefixes()`) | Low |
| Post-processing sanity checks (unit tests for individual rules) | Medium |
| Image larger than available memory | Low |
| Non-JPEG/PNG image formats (WebP, HEIC, etc.) | Medium |
| Platforms: JIO, Tata, Snapdeal, BigBasket, 1MG, Croma, Purplle, Shopsy, Zepto, Lenskart, PharmEasy, Swiggy (13 untested platforms) | Medium |

### Coverage Estimate

- **Extraction pipeline**: ~60% (7/20 platforms tested, core paths tested, edge cases partial)
- **Proof verification**: ~40% (basic OCR fallback tested, no Gemini path, no confidence threshold boundary tests)
- **Rating verification**: ~10% (only route-level validation test)
- **Return window verification**: ~5% (not tested at all)
- **Chat system**: ~30% (greeting/search intents, no keyword routing, no image analysis)
- **Routes/middleware**: ~25% (status + validation, no rate limit or daily limit tests)

---

## 8. Recommendations

### Priority 1 — Fix Now

| # | Action | Files |
|---|--------|-------|
| 1 | **Raise proof rejection threshold** to 75+ or require order ID + amount match | `aiRoutes.ts` |
| 2 | **Guard E2E bypass** with `NODE_ENV === 'test'` check | `aiRoutes.ts` |
| 3 | **Sanitize Gemini error messages** before returning to client | `aiService.ts` |
| 4 | **Add image size validation** (max ~10MB base64) | `aiRoutes.ts` Zod schemas |
| 5 | **Remove `@google/genai`** from `shared/package.json` | `shared/package.json` |

### Priority 2 — Fix Soon

| # | Action | Files |
|---|--------|-------|
| 6 | **Implement early OCR termination** when confidence ≥ 90 | `aiService.ts` |
| 7 | **Move rate limit state to Redis** | `aiRoutes.ts` |
| 8 | **Remove "GOD-LEVEL ACCURACY"** from all prompts | `aiService.ts` |
| 9 | **Add consent notice** for AI chat data processing | Frontend + `aiRoutes.ts` |
| 10 | **Fix UI model name** from "Gemini 3.0 Pro" to actual model | `AppSwitchboard.tsx` |
| 11 | **Delete `test-extraction-logic.ts`** | `backend/scripts/` |
| 12 | **Consolidate duplicate API bindings** | `shared/services/api.ts` |

### Priority 3 — Improve

| # | Action | Files |
|---|--------|-------|
| 13 | **Add tests for 13 untested platforms** | `extraction.spec.ts` |
| 14 | **Add circuit breaker tests** | `ai.spec.ts` |
| 15 | **Make OCR pool size configurable** | `aiService.ts` |
| 16 | **Reduce Gemini fallback to 2–3 models** | `aiService.ts` |
| 17 | **Raise OCR_MAX_CAP to 95** for perfect OCR matches | `aiService.ts` |
| 18 | **Improve high-contrast fallback heuristic** | `aiService.ts` |
| 19 | **Harden prompt injection** with homoglyph normalization | `aiService.ts` |
| 20 | **Move regex patterns** to module-level constants | `aiService.ts` |

### Architecture Consideration

The 3398-line `aiService.ts` monolith should be split:

```
backend/services/ai/
  ├── index.ts              (re-exports)
  ├── geminiClient.ts       (callGeminiWithFallback, circuit breaker)
  ├── ocrEngine.ts          (worker pool, preprocessing, runOcrOnImage)
  ├── chatService.ts        (generateChatUiResponse)
  ├── proofVerifier.ts      (verifyProofWithAi, verifyProofWithOcr)
  ├── ratingVerifier.ts     (verifyRatingScreenshotWithAi)
  ├── returnWindowVerifier.ts
  ├── orderExtractor.ts     (extractOrderDetailsWithAi + all regex)
  ├── platformPatterns.ts   (order ID regexes, platform detection)
  ├── productNameExtractor.ts
  ├── sanityChecks.ts       (post-processing rules)
  ├── security.ts           (prompt injection, sanitization)
  └── constants.ts          (confidence scores, model list)
```

This would reduce cognitive load, improve testability, and allow independent iteration on each subsystem.

---

*End of audit.*
