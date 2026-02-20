# MOBO Backend – Mongoose Database Operations Audit

> **Purpose:** Understand the full migration scope from Mongoose (MongoDB) → Prisma (PostgreSQL).
> Generated from a line-by-line analysis of `controllers/`, `services/`, `middleware/`, and `seeds/`.

---

## Table of Contents

1. [Prisma Client Setup](#1-prisma-client-setup)
2. [Controllers](#2-controllers)
3. [Services](#3-services)
4. [Middleware](#4-middleware)
5. [Seeds](#5-seeds)
6. [Summary Statistics](#6-summary-statistics)
7. [Transaction Usage Map](#7-transaction-usage-map)
8. [Dual-Write Infrastructure](#8-dual-write-infrastructure)

---

## 1. Prisma Client Setup

**File:** `backend/database/prisma.ts` (162 lines)

| Export | Purpose |
|---|---|
| `isPrismaAvailable()` | Returns `true` once Prisma client has been connected |
| `getPrisma()` | Returns client or `null` (safe to call before connect) |
| `prisma()` | Returns client or **throws** if not connected |
| `connectPrisma()` | Initializes PrismaClient with `@prisma/adapter-pg` + pg `Pool` |
| `disconnectPrisma()` | Graceful teardown (pool.end + prisma.$disconnect) |

**Pool Config:** `buildPoolConfig()` parses `DATABASE_URL`, supports SSL (`?sslmode=require`), search_path (`?schema=`). Defaults: `max=10`, `idleTimeoutMillis=30000`, `connectionTimeoutMillis=5000`.

**Generated client path:** `../generated/prisma/client.js`

**File:** `backend/database/dualWriteHooks.ts` (234 lines)

Registers Mongoose `post()` hooks on all 17 models (`save`, `findOneAndUpdate`, `insertMany`, `findOneAndDelete`, `deleteOne`, `updateOne`, `deleteMany`) that fire-and-forget shadow writes to PG. Also exports `resyncAfterBulkUpdate()` for bulk Mongoose mutations.

---

## 2. Controllers

### 2.1 `adminController.ts` (624 lines)

**Models Imported:** `UserModel`, `WalletModel`, `OrderModel`, `SuspensionModel`, `DealModel`, `CampaignModel`, `PayoutModel`, `SystemConfigModel`, `AuditLogModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~42 | Read system config | SystemConfigModel | `findOne().lean()` |
| ~54 | Upsert system config | SystemConfigModel | `findOneAndUpdate({ upsert: true })` |
| ~95 | List users | UserModel | `find()` |
| ~97 | List wallets | WalletModel | `find()` |
| ~111 | List orders | OrderModel | `find()` |
| ~124 | User aggregation | UserModel | `aggregate()` |
| ~126 | Order aggregation | OrderModel | `aggregate()` |
| ~160 | Financial aggregation | OrderModel | `aggregate()` |
| ~187 | List deals | DealModel | `find()` |
| ~198 | Get deal | DealModel | `findById()` |
| ~201 | Check order exists | OrderModel | `exists()` |
| ~205 | Update deal | DealModel | `updateOne()` |
| ~222 | Get user | UserModel | `findById()` |
| ~232 | Check campaign exists | CampaignModel | `exists()` |
| ~236 | Check deal exists | DealModel | `exists()` |
| ~244 | Check order exists | OrderModel | `exists()` |
| ~249 | Check payout exists | PayoutModel | `exists()` |
| ~255 | Get wallet | WalletModel | `findOne()` |
| ~262 | Update wallet | WalletModel | `findOneAndUpdate()` |
| ~269 | Update user | UserModel | `findOneAndUpdate()` |
| ~285 | Get wallet | WalletModel | `findOne()` |
| ~293 | Check payout exists | PayoutModel | `exists()` |
| ~301 | Update wallet | WalletModel | `findOneAndUpdate()` |
| ~318 | Get user for suspend | UserModel | `findById()` |
| ~323 | Update user status | UserModel | `findOneAndUpdate()` |
| ~328 | Create suspension record | SuspensionModel | `create()` |
| ~342 | Freeze deals | DealModel | `updateMany()` |
| ~355 | Freeze deals (batch) | DealModel | `updateMany()` |
| ~501 | Update campaigns | CampaignModel | `updateMany()` |
| ~510 | Create suspension record | SuspensionModel | `create()` |
| ~590 | List audit logs | AuditLogModel | `find()` |
| ~594 | Count audit logs | AuditLogModel | `countDocuments()` |

**Transactions:** None directly (delegates to `freezeOrders` service).

---

### 2.2 `authController.ts` (740 lines)

**Models Imported:** `UserModel`, `InviteModel` (+ `mongoose` for sessions)

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~50 | Get profile | UserModel | `findById()` |
| ~72 | Check existing user | UserModel | `findOne({ mobile, deletedAt })` |
| ~83 | Consume invite | InviteModel | `findOne().session()` |
| ~105 | Uniqueness check | UserModel | `findOne().session()` |
| ~112 | Create user | UserModel | `create([...], { session })` |
| ~196 | Login lookup | UserModel | `findOne()` |
| ~230 | Lockout update | UserModel | `findOneAndUpdate()` |
| ~240 | Lockout reset | UserModel | `findOneAndUpdate()` |
| ~260 | Token refresh lookup | UserModel | `findById().lean()` |
| ~280 | Ops register check | UserModel | `findOne()` |
| ~290 | Ops invite consume | InviteModel | `findOne().session()` |
| ~325 | Ops username check | UserModel | `findOne().session()` |
| ~350 | Ops exists check | UserModel | `exists().session()` |
| ~355 | Ops create user | UserModel | `create([...], { session })` |
| ~595 | Brand invite consume | InviteModel | `findOne().session()` |
| ~615 | Brand exists check | UserModel | `exists().session()` |
| ~620 | Brand create user | UserModel | `create([...], { session })` |
| ~690 | Profile update | UserModel | `findByIdAndUpdate()` |

**Transactions:** **YES** — `withTransaction()` helper (line ~30) using `mongoose.startSession()` + `session.withTransaction()`. Used for:
- `register` (shopper registration)
- `registerOps` (ops/agency/mediator registration)
- `registerBrand` (brand registration)

---

### 2.3 `brandController.ts` (878 lines)

**Models Imported:** `UserModel`, `CampaignModel`, `OrderModel`, `DealModel`, `TransactionModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~33 | Idempotent deposit | TransactionModel | `findOneAndUpdate({ upsert: true })` |
| ~51 | Idempotent deposit | TransactionModel | `findOneAndUpdate({ upsert: true })` |
| ~85 | Get brand profile | UserModel | `findById()` |
| ~91 | Connected agencies | UserModel | `find()` |
| ~100 | Brand campaigns | CampaignModel | `find()` |
| ~114 | Brand orders | OrderModel | `find()` |
| ~137 | Brand transactions | TransactionModel | `find()` |
| ~152 | All agencies | UserModel | `find()` |
| ~175 | Get agency | UserModel | `findById()` |
| ~183 | Get brand | UserModel | `findById()` |
| ~254 | Connect agency check | UserModel | `findOne()` |
| ~259 | Connect agency check | UserModel | `findOne()` |
| ~268 | Get brand | UserModel | `findById()` |
| ~278 | Update brand connected | UserModel | `findOneAndUpdate()` |
| ~316 | Remove agency | UserModel | `findOneAndUpdate()` |
| ~340 | Reset campaign access | CampaignModel | `updateMany()` |
| ~505 | Validate agencies | UserModel | `find()` |
| ~515 | Update brand | UserModel | `findOneAndUpdate()` |
| ~521 | Create campaign | CampaignModel | `create()` |
| ~590 | Get campaign | CampaignModel | `findById()` |
| ~620 | List mediators | UserModel | `find()` |
| ~632 | Update brand | UserModel | `findOneAndUpdate()` |
| ~640 | Check orders exist | OrderModel | `exists()` |
| ~680 | Update campaign | CampaignModel | `findByIdAndUpdate()` |
| ~690 | Update deals | DealModel | `updateMany()` |
| ~720 | Get campaign for copy | CampaignModel | `findById()` |
| ~750 | Create campaign copy | CampaignModel | `create()` |
| ~780 | Get campaign for delete | CampaignModel | `findById()` |
| ~790 | Check orders exist | OrderModel | `exists()` |
| ~795 | Soft-delete campaign | CampaignModel | `updateOne()` |
| ~800 | Soft-delete deals | DealModel | `updateMany()` |

**Transactions:** **YES** — `mongoose.startSession()` + `payoutSession.withTransaction()` in `payoutAgency` (line ~215) for atomic brand-wallet debit + agency-wallet credit.

---

### 2.4 `inviteController.ts` (~250 lines)

**Models Imported:** `InviteModel`, `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~23 | Duplicate check | InviteModel | `exists()` |
| ~30 | Create invite | InviteModel | `create()` |
| ~86 | List invites | InviteModel | `find()` |
| ~95 | Get invite for delete | InviteModel | `findOne()` |
| ~110 | Delete invite | invite | `deleteOne()` |
| ~120 | Get user for agency | UserModel | `findById()` |
| ~140 | Save agency codes | agency | `save()` |
| ~142 | Mediator invite exists | InviteModel | `exists()` |
| ~148 | Create mediator invite | InviteModel | `create()` |
| ~170 | Get user for buyer | UserModel | `findById()` |
| ~185 | Buyer invite exists | InviteModel | `exists()` |
| ~190 | Create buyer invite | InviteModel | `create()` |

**Transactions:** None

---

### 2.5 `notificationsController.ts` (~200 lines)

**Models Imported:** `UserModel`, `OrderModel`, `PayoutModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~47 | Recent orders | OrderModel | `find().select().sort().limit()` |
| ~155 | Count users | UserModel | `countDocuments()` |
| ~156 | Count orders | OrderModel | `countDocuments()` |
| ~165 | Recent payouts | PayoutModel | `find().select().sort().limit()` |

**Transactions:** None

---

### 2.6 `ordersController.ts` (930 lines)

**Models Imported:** `UserModel`, `CampaignModel`, `DealModel`, `OrderModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~44 | Get order | OrderModel | `findById()` |
| ~45 | Get order by filter | OrderModel | `findOne()` |
| ~208 | Get buyer | UserModel | `findById()` |
| ~215 | Velocity limit | OrderModel | `countDocuments()` |
| ~216 | Velocity limit | OrderModel | `countDocuments()` |
| ~225 | Duplicate external ID | OrderModel | `exists()` |
| ~237 | Duplicate deal check | OrderModel | `findOne()` |
| ~268 | Claim campaign slot | CampaignModel | `findOne().session()` |
| ~281 | Get buyer user | UserModel | `findOne()` |
| ~288 | Get agency user | UserModel | `findOne()` |
| ~310 | Mediator sales count | OrderModel | `countDocuments()` |
| ~318 | Get deal | DealModel | `findById()` |
| ~330 | Atomic slot claim | CampaignModel | `findOneAndUpdate({ session })` |
| ~340 | Pre-order check | OrderModel | `findOne().session()` |
| ~370 | Save pre-order | order | `save({ session })` |
| ~388 | Create order | OrderModel | `create([...], { session })` |
| ~420 | Save order | order | `save()` |
| ~445 | Get order for claim | OrderModel | `findById()` |
| ~500 | Rate AI user check | UserModel | `findById()` |
| ~530 | Save order proof | order | `save()` |
| ~560 | Audience user lookup | UserModel | `findOne()` |

**Transactions:** **YES** — `mongoose.startSession()` (line ~203) + `session.withTransaction()` (line ~335) for atomic order creation with campaign slot decrement.

---

### 2.7 `productsController.ts` (~160 lines)

**Models Imported:** `DealModel`, `OrderModel`, `CampaignModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~32 | List buyer deals | DealModel | `find()` |
| ~60 | Get deal | DealModel | `findOne()` |
| ~70 | Get campaign | CampaignModel | `findById()` |
| ~80 | Create pre-order | OrderModel | `create()` |

**Transactions:** None

---

### 2.8 `ticketsController.ts` (~450 lines)

**Models Imported:** `TicketModel`, `OrderModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~25 | Get order for audience | OrderModel | `findById()` |
| ~55 | Scope mediator orders | OrderModel | `find()` |
| ~65 | Scope agency orders | OrderModel | `find()` |
| ~75 | Scope brand orders | OrderModel | `find()` |
| ~90 | Validate order ref | OrderModel | `findById()` |
| ~140 | List tickets (mediator) | TicketModel | `find()` |
| ~150 | List tickets (agency) | TicketModel | `find()` |
| ~160 | List tickets (admin) | TicketModel | `find()` |
| ~185 | Create ticket | TicketModel | `create()` |
| ~210 | Get ticket | TicketModel | `findById()` |
| ~230 | Update ticket | TicketModel | `findByIdAndUpdate()` |
| ~270 | Update ticket | TicketModel | `findByIdAndUpdate()` |

**Transactions:** None

---

### 2.9 `pushNotificationsController.ts` (~110 lines)

**Models Imported:** `PushSubscriptionModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~55 | Upsert subscription | PushSubscriptionModel | `findOneAndUpdate({ upsert: true })` |
| ~80 | Remove subscription | PushSubscriptionModel | `deleteOne()` |

**Transactions:** None

---

### 2.10 `opsController.ts` (2779 lines)

**Models Imported:** `UserModel`, `WalletModel`, `CampaignModel`, `OrderModel`, `TicketModel`, `DealModel`, `PayoutModel`, `TransactionModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~155 | Load user | UserModel | `findOne()` |
| ~170 | Update user | UserModel | `findOneAndUpdate()` |
| ~225 | List mediators | UserModel | `find()` |
| ~240 | List wallets | WalletModel | `find()` |
| ~290 | List campaigns | CampaignModel | `find()` |
| ~350 | List deals | DealModel | `find()` |
| ~390 | List orders | OrderModel | `find()` |
| ~425 | Pending users | UserModel | `find()` |
| ~440 | Pending wallets | WalletModel | `find()` |
| ~460 | Verified users | UserModel | `find()` |
| ~475 | Verified wallets | WalletModel | `find()` |
| ~515 | Agency mediators | UserModel | `find()` |
| ~530 | Ledger payouts | PayoutModel | `find()` |
| ~535 | Ledger users | UserModel | `find()` |
| ~560 | Approve mediator | UserModel | `findById()` |
| ~575 | Update mediator | UserModel | `findByIdAndUpdate()` |
| ~610 | Reject mediator | UserModel | `findById()` |
| ~635 | Update mediator | UserModel | `findByIdAndUpdate()` |
| ~680 | Approve user | UserModel | `findById()` |
| ~710 | Update user | UserModel | `findByIdAndUpdate()` |
| ~740 | Reject user | UserModel | `findById()` |
| ~770 | Update user | UserModel | `findByIdAndUpdate()` |
| ~800 | Verify order claim | OrderModel | `findById()` |
| ~870 | Save order | order | `save()` |
| ~910 | Reload order | OrderModel | `findById()` |
| ~930 | Verify requirement | OrderModel | `findById()` |
| ~985 | Save order | order | `save()` |
| ~995 | Reload order | OrderModel | `findById()` |
| ~1005 | Verify all steps | OrderModel | `findById()` |
| ~1080 | Save order | order | `save()` |
| ~1095 | Reload order | OrderModel | `findById()` |
| ~1110 | Reject order proof | OrderModel | `findById()` |
| ~1195 | Release campaign slot | CampaignModel | `findOneAndUpdate()` |
| ~1210 | Save rejected order | order | `save()` |
| ~1245 | Missing proof request | OrderModel | `findById()` |
| ~1310 | Save order | order | `save()` |
| ~1340 | Settle order | OrderModel | `findById()` |
| ~1390 | Get buyer | UserModel | `findById()` |
| ~1400 | Dispute check | TicketModel | `exists()` |
| ~1415 | Save order | order | `save()` |
| ~1445 | Get campaign | CampaignModel | `findById()` |
| ~1465 | Count orders | OrderModel | `countDocuments()` |
| ~1490 | Get deal | DealModel | `findById()` |
| ~1536 | Find mediator | UserModel | `findOne({ mediatorCode }).lean()` |
| ~1551 | **Settlement session start** | mongoose | `startSession()` |
| ~1553 | **Settlement transaction** | session | `withTransaction()` |
| ~1617 | **Workflow session start** | mongoose | `startSession()` |
| ~1619 | **Workflow transaction** | session | `withTransaction()` |
| ~1620 | Save order in txn | order | `save({ session })` |
| ~1666 | **Unsettlement** | | |
| ~1676 | Load order | OrderModel | `findById()` |
| ~1710 | Get campaign | CampaignModel | `findById().lean()` |
| ~1720 | Get deal | DealModel | `findById().lean()` |
| ~1750 | Find mediator | UserModel | `findOne({ mediatorCode }).lean()` |
| ~1760 | **Unsettle session start** | mongoose | `startSession()` |
| ~1763 | **Unsettle transaction** | session | `withTransaction()` |
| ~1828 | Save order in txn | order | `save({ session })` |
| ~1850 | Save order (non-wallet) | order | `save()` |
| ~1890 | **createCampaign** | | |
| ~1910 | Get brand | UserModel | `findById().lean()` |
| ~1935 | Create campaign | CampaignModel | `create()` |
| ~1970 | Create campaign (non-priv) | CampaignModel | `create()` |
| ~2005 | **updateCampaignStatus** | | |
| ~2020 | Get campaign | CampaignModel | `findById()` |
| ~2040 | Save campaign | campaign | `save()` |
| ~2045 | Update deals status | DealModel | `updateMany()` |
| ~2100 | **deleteCampaign** | | |
| ~2110 | Get campaign | CampaignModel | `findById().select().lean()` |
| ~2120 | Check orders exist | OrderModel | `exists()` |
| ~2130 | Soft-delete campaign | CampaignModel | `findOneAndUpdate()` |
| ~2140 | Soft-delete deals | DealModel | `updateMany()` |
| ~2180 | **assignSlots** | | |
| ~2190 | Get campaign | CampaignModel | `findById()` |
| ~2210 | Check orders exist | OrderModel | `exists()` |
| ~2250 | Validate mediators | UserModel | `find()` |
| ~2300 | Save campaign | campaign | `save()` (with `increment()` for OCC) |
| ~2330 | **publishDeal** | | |
| ~2340 | Get campaign | CampaignModel | `findById().lean()` |
| ~2400 | Check existing deal | DealModel | `findOne().lean()` |
| ~2410 | Update existing deal | DealModel | `findOneAndUpdate()` |
| ~2420 | Create new deal | DealModel | `create()` |
| ~2450 | **payoutMediator** | | |
| ~2475 | Get user | UserModel | `findById()` |
| ~2510 | Get wallet | ensureWallet() | → `WalletModel.findOneAndUpdate({ upsert })` |
| ~2530 | **Payout session start** | mongoose | `startSession()` |
| ~2533 | **Payout transaction** | session | `withTransaction()` |
| ~2535 | Create payout | PayoutModel | `create([...], { session })` |
| ~2570 | **deletePayout** | | |
| ~2580 | Get payout | PayoutModel | `findById().lean()` |
| ~2590 | Get beneficiary | UserModel | `findById().lean()` |
| ~2610 | Check ledger entries | TransactionModel | `exists()` |
| ~2620 | Soft-delete payout | PayoutModel | `updateOne()` |
| ~2660 | **getTransactions** | | |
| ~2670 | List transactions | TransactionModel | `find().sort().limit()` |
| ~2690 | **copyCampaign** | | |
| ~2700 | Get source campaign | CampaignModel | `findById().lean()` |
| ~2730 | Create campaign copy | CampaignModel | `create()` |
| ~2750 | **declineOffer** | | |
| ~2760 | Get campaign | CampaignModel | `findById().select().lean()` |
| ~2770 | Remove agency code | CampaignModel | `findOneAndUpdate({ $pull })` |

**Transactions:** **YES** — Four distinct transaction blocks:
1. **Settlement** (line ~1551): `mongoose.startSession()` + `withTransaction()` — atomic wallet debit (brand) + credit (buyer) + credit (mediator)
2. **Workflow** (line ~1617): `mongoose.startSession()` + `withTransaction()` — atomic order save + two workflow transitions
3. **Unsettlement** (line ~1760): `mongoose.startSession()` + `withTransaction()` — reverse all settlement wallet mutations + reset order state
4. **Payout** (line ~2530): `mongoose.startSession()` + `withTransaction()` — atomic payout creation + wallet debit

---

## 3. Services

### 3.1 `aiService.ts` (3510 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** Gemini AI chat + OCR screenshot extraction for order verification. Pure compute, no DB.

---

### 3.2 `audit.ts` (46 lines)

**Models Imported:** `AuditLogModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~27 | Create audit log | AuditLogModel | `create()` |

**Transactions:** None. Also triggers `dualWriteAuditLog()` fire-and-forget.

---

### 3.3 `authz.ts` (28 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** Pure authorization helpers (`getRequester`, `isPrivileged`, `requireAnyRole`, `requireSelfOrPrivileged`).

---

### 3.4 `codes.ts` (7 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** Generates random human-readable codes with `crypto.randomBytes`.

---

### 3.5 `dualWrite.ts` (819 lines)

**Models Imported:** None (uses Prisma, not Mongoose)

**Prisma DB Operations (PG shadow writes):**

| Line(s) | Operation | Prisma Model | Method |
|---|---|---|---|
| ~105 | Upsert user | `db.user` | `upsert()` |
| ~112 | Sync pending connections | `db.pendingConnection` | `deleteMany()` + `createMany()` |
| ~140 | Resolve owner | `db.user` | `findUnique()` |
| ~155 | Upsert brand | `db.brand` | `upsert()` |
| ~175 | Upsert agency | `db.agency` | `upsert()` |
| ~195 | Upsert mediator profile | `db.mediatorProfile` | `upsert()` |
| ~215 | Upsert shopper profile | `db.shopperProfile` | `upsert()` |
| ~260 | Upsert campaign | `db.campaign` | `upsert()` |
| ~320 | Upsert deal | `db.deal` | `upsert()` |
| ~380 | Upsert order | `db.order` | `upsert()` |
| ~420 | Sync order items | `db.orderItem` | `deleteMany()` + `createMany()` |
| ~465 | Upsert wallet | `db.wallet` | `upsert()` |
| ~510 | Upsert transaction | `db.transaction` | `upsert()` |
| ~555 | Upsert payout | `db.payout` | `upsert()` |
| ~620 | Upsert invite | `db.invite` | `upsert()` |
| ~670 | Upsert ticket | `db.ticket` | `upsert()` |
| ~710 | Upsert push subscription | `db.pushSubscription` | `upsert()` |
| ~740 | Upsert suspension | `db.suspension` | `upsert()` |
| ~780 | Upsert audit log | `db.auditLog` | `upsert()` |
| ~810 | Upsert system config | `db.systemConfig` | `upsert()` |

**Transactions:** None (all fire-and-forget).

---

### 3.6 `invites.ts` (135 lines)

**Models Imported:** `InviteModel`, `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~8 | Get user by ID | UserModel | `findById().session().lean()` |
| ~18 | Get user by code | UserModel | `findOne().session().lean()` |
| ~33 | Get issuer | UserModel | `findById()` (via `ensureActiveUserById`) |
| ~46 | Get parent | UserModel | `findById()` (via `ensureActiveUserById`) |
| ~54 | Get upstream agency | UserModel | `findOne()` (via `ensureActiveUserByCode`) |
| ~68 | Get invite snapshot | InviteModel | `findOne().session().lean()` |
| ~88 | Expire invite | InviteModel | `findOneAndUpdate()` |
| ~95 | Enforce upstream active | UserModel | multiple calls via helpers |
| ~102 | Atomic consume invite | InviteModel | `findOneAndUpdate()` (aggregation pipeline update) |
| ~120 | Get invite for revoke | InviteModel | `findOne()` |
| ~127 | Save revoked invite | invite | `save()` |

**Transactions:** None directly, but respects caller's `session` parameter (joins external txn).

---

### 3.7 `lineage.ts` (37 lines)

**Models Imported:** `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~4 | List mediators for agency | UserModel | `find().select().lean()` |
| ~12 | Get agency for mediator | UserModel | `findOne().select().lean()` |
| ~20 | Check agency active | UserModel | `findOne().select().lean()` |
| ~28 | Check mediator active | UserModel | `findOne().select().lean()` |

**Transactions:** None

---

### 3.8 `orderEvents.ts` (45 lines)

**Models Imported:** None (only type imports from Mongoose)  
**DB Operations:** None  
**Purpose:** Pure utility for pushing events to an order's events array and checking terminal affiliate status.

---

### 3.9 `orderWorkflow.ts` (175 lines)

**Models Imported:** `OrderModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~72 | Transition order workflow | OrderModel | `findOneAndUpdate({ session })` |
| ~85 | Get order for error context | OrderModel | `findById().select().lean()` |
| ~120 | Freeze orders (bulk) | OrderModel | `updateMany({ session })` |
| ~155 | Reactivate order | OrderModel | `findOneAndUpdate({ session })` |

**Transactions:** None directly, but accepts `session` parameter (joins caller's transaction).

---

### 3.10 `passwords.ts` (27 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** bcrypt password hashing with SHA-256 pre-hash for long passwords.

---

### 3.11 `pushNotifications.ts` (~170 lines)

**Models Imported:** `PushSubscriptionModel`, `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~62 | Remove invalid subscription | PushSubscriptionModel | `deleteOne()` |
| ~72 | Find user subscriptions | PushSubscriptionModel | `find().select().lean()` |
| ~140 | Find mediators for push | UserModel | `find().select().lean()` |

**Transactions:** None

---

### 3.12 `realtimeHub.ts` (37 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** EventEmitter-based SSE pub/sub hub. Pure in-memory.

---

### 3.13 `roleDocuments.ts` (90 lines)

**Models Imported:** `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~25 | Upsert agency doc | AgencyModel | `findOneAndUpdate({ upsert, session })` |
| ~45 | Upsert brand doc | BrandModel | `findOneAndUpdate({ upsert, session })` |
| ~65 | Upsert mediator profile | MediatorProfileModel | `findOneAndUpdate({ upsert, session })` |
| ~80 | Upsert shopper profile | ShopperProfileModel | `findOneAndUpdate({ upsert, session })` |

**Transactions:** None directly; accepts `session` parameter, joins caller's transaction. Also fires dual-write for each model.

---

### 3.14 `sheetsService.ts` (388 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** Google Sheets export via REST API (no DB).

---

### 3.15 `tokens.ts` (19 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** JWT signing helpers for access/refresh tokens.

---

### 3.16 `walletService.ts` (240 lines)

**Models Imported:** `WalletModel`, `TransactionModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~29 | Ensure wallet (upsert) | WalletModel | `findOneAndUpdate({ upsert: true })` |
| ~42 | Fallback wallet read | WalletModel | `findOne()` |
| ~60 | Idempotency check (credit) | TransactionModel | `findOne().read('primary').session()` |
| ~72 | Credit wallet | WalletModel | `findOneAndUpdate({ upsert, $inc, session })` |
| ~88 | Create credit transaction | TransactionModel | `create([...], { session })` |
| ~105 | Read wallet for dual-write | WalletModel | `findOne().lean()` |
| ~110 | **Credit session start** | mongoose | `startSession()` |
| ~112 | **Credit transaction** | session | `withTransaction()` |
| ~130 | Idempotency check (debit) | TransactionModel | `findOne().read('primary').session()` |
| ~145 | Debit wallet | WalletModel | `findOneAndUpdate({ $gte check, $inc, session })` |
| ~160 | Insufficient funds check | WalletModel | `findOne().session()` |
| ~170 | Create debit transaction | TransactionModel | `create([...], { session })` |
| ~190 | Read wallet for dual-write | WalletModel | `findOne().lean()` |
| ~195 | **Debit session start** | mongoose | `startSession()` |
| ~197 | **Debit transaction** | session | `withTransaction()` |

**Transactions:** **YES** — Two internal transaction patterns:
1. `applyWalletCredit()`: creates own `mongoose.startSession()` if no external session provided
2. `applyWalletDebit()`: creates own `mongoose.startSession()` if no external session provided

Both also support joining an external caller-provided session.

---

## 4. Middleware

### 4.1 `auth.ts` (~180 lines)

**Models Imported:** `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~48 | JWT user lookup | UserModel | `findById().select().lean()` |
| ~70 | Agency upstream check | UserModel | `findOne()` |
| ~82 | Mediator upstream check | UserModel | `findOne()` |
| ~92 | Agency-of-mediator check | UserModel | `findOne()` |

**Transactions:** None. Runs on **every authenticated request** (zero-trust DB verification).

---

### 4.2 `errors.ts` (~130 lines)

**Models Imported:** None  
**DB Operations:** None  
**Purpose:** Express error-handling middleware with AppError class.

---

## 5. Seeds

### 5.1 `admin.ts` (95 lines)

**Models Imported:** `UserModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~60 | Find admin by username | UserModel | `findOne()` |
| ~63 | Find admin by mobile | UserModel | `findOne()` |
| ~67 | Check username taken | UserModel | `findOne().lean()` |
| ~90 | Save admin user | user | `save()` |

**Transactions:** None

---

### 5.2 `dev.ts` (~230 lines)

**Models Imported:** `UserModel`, `WalletModel`, `CampaignModel`, `DealModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~68 | Find user by mobile | UserModel | `findOne()` |
| ~80 | Save user | user | `save()` |
| ~100 | Upsert brand wallet | WalletModel | `findOneAndUpdate({ upsert })` |
| ~108 | Save wallet | wallet | `save()` |
| ~130 | Find existing campaign | CampaignModel | `findOne().lean()` |
| ~135 | Create campaign | CampaignModel | `create()` |
| ~160 | Find existing deal | DealModel | `findOne().lean()` |
| ~165 | Create deal | DealModel | `create()` |

Also calls `ensureRoleDocumentsForUser()` which triggers 4 more upserts via `roleDocuments.ts`.

**Transactions:** None

---

### 5.3 `e2e.ts` (~220 lines)

**Models Imported:** `UserModel`, `WalletModel`, `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`, `CampaignModel`, `DealModel`, `OrderModel`, `TicketModel`, `InviteModel`, `TransactionModel`, `PayoutModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~80–92 | **Wipe all collections** | 13 models | `deleteMany({})` |
| ~95 | Create admin | UserModel | `create()` |
| ~105 | Create agency | UserModel | `create()` |
| ~115 | Create mediator | UserModel | `create()` |
| ~125 | Create brand | UserModel | `create()` |
| ~140 | Create shopper | UserModel | `create()` |
| ~150 | Create shopper2 | UserModel | `create()` |
| ~160 | Ensure role docs | Multiple | via `ensureRoleDocumentsForUser()` |
| ~170 | Upsert brand wallet | WalletModel | `findOneAndUpdate({ upsert })` |
| ~185 | Create campaign | CampaignModel | `create()` |
| ~210 | Create deal | DealModel | `create()` |

**Transactions:** None

---

### 5.4 `seed.ts` (605 lines)

**Models Imported:** `UserModel`, `WalletModel`, `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`, `CampaignModel`, `DealModel`, `OrderModel`, `TicketModel`, `PayoutModel`, `TransactionModel`, `InviteModel`, `AuditLogModel`, `SuspensionModel`

| Line(s) | Operation | Model | Method |
|---|---|---|---|
| ~65–79 | **Wipe all 15 collections** | 15 models | `deleteMany({})` |
| ~85 | Create admin | UserModel | `create()` |
| ~95 | Create demo agency user | UserModel | `create()` |
| ~100 | Create agency doc | AgencyModel | `create()` |
| ~110 | Create demo mediator user | UserModel | `create()` |
| ~115 | Create mediator profile | MediatorProfileModel | `create()` |
| ~125 | Create demo brand user | UserModel | `create()` |
| ~130 | Create brand doc | BrandModel | `create()` |
| ~140 | Create demo shopper user | UserModel | `create()` |
| ~145 | Create shopper profile | ShopperProfileModel | `create()` |
| ~150 | Ensure wallets (×5) | WalletModel | via `ensureWallet()` |
| ~170–200 | Create agencies in loop | UserModel, AgencyModel | `create()` |
| ~205 | Fund agencies | WalletModel, TransactionModel | via `applyWalletCredit()` |
| ~215–250 | Create brands in loop | UserModel, BrandModel | `create()` |
| ~255 | Fund brands | WalletModel, TransactionModel | via `applyWalletCredit()` |
| ~265–300 | Create mediators in loop | UserModel, MediatorProfileModel | `create()` |
| ~305 | Fund mediators | WalletModel, TransactionModel | via `applyWalletCredit()` |
| ~315–350 | Create shoppers in loop | UserModel, ShopperProfileModel | `create()` |
| ~355 | Fund shoppers | WalletModel, TransactionModel | via `applyWalletCredit()` |
| ~365–400 | Create campaigns | CampaignModel | `create()` |
| ~410–430 | Create deals | DealModel | `updateOne({ upsert: true })` |
| ~440 | Index deals | DealModel | `find().limit().lean()` |
| ~460–500 | Create orders | OrderModel | `create()` |
| ~510–520 | Get buyer for ticket | UserModel | `findById().lean()` |
| ~525 | Create tickets | TicketModel | `create()` |
| ~535 | Ensure wallet for payout | WalletModel | via `ensureWallet()` |
| ~540 | Create payouts | PayoutModel | `create()` |

**Transactions:** None directly, but `applyWalletCredit()` creates its own sessions internally.

---

## 6. Summary Statistics

### Mongoose Models Used (17 total)

| # | Model | Collections Using It |
|---|---|---|
| 1 | `UserModel` | adminCtrl, authCtrl, brandCtrl, inviteCtrl, notificationsCtrl, ordersCtrl, opsCtrl, auth middleware, invites svc, lineage svc, pushNotifications svc, roleDocuments svc, all seeds |
| 2 | `OrderModel` | adminCtrl, brandCtrl, notificationsCtrl, ordersCtrl, opsCtrl, ticketsCtrl, productsCtrl, orderWorkflow svc, e2e seed, seed.ts |
| 3 | `CampaignModel` | adminCtrl, brandCtrl, ordersCtrl, opsCtrl, productsCtrl, dev seed, e2e seed, seed.ts |
| 4 | `DealModel` | adminCtrl, brandCtrl, ordersCtrl, opsCtrl, productsCtrl, dev seed, e2e seed, seed.ts |
| 5 | `WalletModel` | adminCtrl, opsCtrl, walletService, dev seed, e2e seed, seed.ts |
| 6 | `InviteModel` | authCtrl, inviteCtrl, invites svc, e2e seed, seed.ts |
| 7 | `TransactionModel` | brandCtrl, opsCtrl, walletService, e2e seed, seed.ts |
| 8 | `PayoutModel` | adminCtrl, notificationsCtrl, opsCtrl, e2e seed, seed.ts |
| 9 | `TicketModel` | opsCtrl, ticketsCtrl, e2e seed, seed.ts |
| 10 | `SuspensionModel` | adminCtrl, seed.ts |
| 11 | `PushSubscriptionModel` | pushNotificationsCtrl, pushNotifications svc |
| 12 | `AuditLogModel` | adminCtrl, audit svc, seed.ts |
| 13 | `SystemConfigModel` | adminCtrl |
| 14 | `AgencyModel` | roleDocuments svc, e2e seed, seed.ts |
| 15 | `BrandModel` | roleDocuments svc, e2e seed, seed.ts |
| 16 | `MediatorProfileModel` | roleDocuments svc, e2e seed, seed.ts |
| 17 | `ShopperProfileModel` | roleDocuments svc, e2e seed, seed.ts |

### DB Operation Counts by Type

| Operation Type | Approx. Count |
|---|---|
| `find()` / `find({}).lean()` | ~45 |
| `findOne()` / `findOne({}).lean()` | ~30 |
| `findById()` / `findById().lean()` | ~35 |
| `findOneAndUpdate()` | ~25 |
| `findByIdAndUpdate()` | ~8 |
| `create()` | ~40 |
| `save()` | ~20 |
| `exists()` | ~12 |
| `updateOne()` | ~5 |
| `updateMany()` | ~10 |
| `deleteOne()` | ~3 |
| `deleteMany()` | ~17 (mostly seeds) |
| `countDocuments()` | ~8 |
| `aggregate()` | ~3 |
| **Total Mongoose operations** | **~261** |
| **Prisma shadow-write operations** | ~18 upserts (dualWrite.ts) |

---

## 7. Transaction Usage Map

| Location | Session Variable | Purpose | Models Mutated |
|---|---|---|---|
| `authController.ts` (`register`) | `withTransaction` | Atomic user registration + invite consumption | UserModel, InviteModel |
| `authController.ts` (`registerOps`) | `withTransaction` | Atomic ops/agency/mediator registration + invite | UserModel, InviteModel |
| `authController.ts` (`registerBrand`) | `withTransaction` | Atomic brand registration + invite | UserModel, InviteModel |
| `brandController.ts` (`payoutAgency`) | `payoutSession` | Atomic brand wallet debit + agency wallet credit | WalletModel, TransactionModel |
| `ordersController.ts` (`createOrder`) | `session` | Atomic order creation + campaign slot decrement | OrderModel, CampaignModel |
| `opsController.ts` (`settleOrderPayment`) | `settlementSession` | Atomic settlement: brand debit + buyer credit + mediator credit | WalletModel, TransactionModel |
| `opsController.ts` (`settleOrderPayment`) | `wfSession` | Atomic order save + workflow transitions | OrderModel |
| `opsController.ts` (`unsettleOrderPayment`) | `unsettleSession` | Reverse settlement: brand credit + buyer debit + mediator debit + order reset | WalletModel, TransactionModel, OrderModel |
| `opsController.ts` (`payoutMediator`) | `session` | Atomic payout creation + wallet debit | PayoutModel, WalletModel, TransactionModel |
| `walletService.ts` (`applyWalletCredit`) | `session` | Atomic wallet credit + transaction record | WalletModel, TransactionModel |
| `walletService.ts` (`applyWalletDebit`) | `session` | Atomic wallet debit + transaction record | WalletModel, TransactionModel |
| `orderWorkflow.ts` (`transitionOrderWorkflow`) | external `session` | Atomic workflow state transition | OrderModel |
| `orderWorkflow.ts` (`freezeOrders`) | external `session` | Bulk freeze orders | OrderModel |
| `orderWorkflow.ts` (`reactivateOrder`) | external `session` | Reactivate frozen order | OrderModel |

**Key Observation:** Wallet operations are the most transaction-critical part of the system. All money movements use MongoDB sessions for atomicity. Migration to Prisma will require PostgreSQL transactions with equivalent guarantees.

---

## 8. Dual-Write Infrastructure

The codebase maintains a **shadow-write** pattern from MongoDB → PostgreSQL:

1. **`dualWriteHooks.ts`** — Mongoose post-hooks automatically fire PG upserts on all 17 models for `save`, `findOneAndUpdate`, `insertMany`, `findOneAndDelete`, `deleteOne`, `updateOne`
2. **`dualWrite.ts`** — 18 individual `dualWrite*()` functions that map Mongoose documents to Prisma `upsert()` calls
3. **`resyncAfterBulkUpdate()`** — Explicit helper for `updateMany`/`deleteMany` bulk ops (controllers call this manually)
4. **Feature flag:** `DUAL_WRITE_ENABLED=true` env var controls activation
5. **All PG writes are fire-and-forget** — failures logged but never thrown

### Files that reference dualWrite / resyncAfterBulkUpdate

| File | Dual-write calls |
|---|---|
| `audit.ts` | `dualWriteAuditLog()` |
| `walletService.ts` | `dualWriteWallet()`, `dualWriteTransaction()` |
| `roleDocuments.ts` | `dualWriteAgency()`, `dualWriteBrand()`, `dualWriteMediatorProfile()`, `dualWriteShopperProfile()` |
| `orderWorkflow.ts` | `dualWriteOrder()`, `resyncAfterBulkUpdate('Order')` |
| `opsController.ts` | `resyncAfterBulkUpdate('Deal')` (after campaign status changes, deletions) |
| `brandController.ts` | `resyncAfterBulkUpdate('Deal')` (after campaign changes) |
| `adminController.ts` | `resyncAfterBulkUpdate('Deal')` (after freeze operations) |

---

*Audit completed. All 10 controllers, 16 services, 2 middleware, and 4 seed files analyzed.*
