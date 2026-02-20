# MOBO Backend — Exhaustive Mongoose DB Operations Audit

> **Purpose**: Complete inventory of every Mongoose model usage across the backend, to plan a migration from MongoDB-primary to PostgreSQL-primary.
>
> **Generated from**: Full read of every file in `controllers/`, `services/`, `seeds/`, `middleware/`, and `database/`.

---

## Table of Contents

1. [Mongoose Models (17)](#1-mongoose-models-17)
2. [Prisma Models (19)](#2-prisma-models-19)
3. [Dual-Write Infrastructure](#3-dual-write-infrastructure)
4. [Per-File Audit: Controllers](#4-per-file-audit-controllers)
5. [Per-File Audit: Services](#5-per-file-audit-services)
6. [Per-File Audit: Middleware](#6-per-file-audit-middleware)
7. [Per-File Audit: Seeds](#7-per-file-audit-seeds)
8. [Per-File Audit: Database Infrastructure](#8-per-file-audit-database-infrastructure)
9. [Aggregate Statistics](#9-aggregate-statistics)
10. [Mongoose Transaction Usage](#10-mongoose-transaction-usage)
11. [Migration Risk Matrix](#11-migration-risk-matrix)

---

## 1. Mongoose Models (17)

All models live in `backend/models/`:

| # | Model Name          | Export Name              | Collection (inferred) |
|---|---------------------|--------------------------|-----------------------|
| 1 | User                | `UserModel`              | users                 |
| 2 | Wallet              | `WalletModel`            | wallets               |
| 3 | Order               | `OrderModel`             | orders                |
| 4 | Campaign            | `CampaignModel`          | campaigns             |
| 5 | Deal                | `DealModel`              | deals                 |
| 6 | Brand               | `BrandModel`             | brands                |
| 7 | Agency              | `AgencyModel`            | agencies              |
| 8 | MediatorProfile     | `MediatorProfileModel`   | mediatorprofiles      |
| 9 | ShopperProfile      | `ShopperProfileModel`    | shopperprofiles       |
| 10| Invite              | `InviteModel`            | invites               |
| 11| Ticket              | `TicketModel`            | tickets               |
| 12| Payout              | `PayoutModel`            | payouts               |
| 13| Transaction         | `TransactionModel`       | transactions          |
| 14| PushSubscription    | `PushSubscriptionModel`  | pushsubscriptions     |
| 15| Suspension          | `SuspensionModel`        | suspensions           |
| 16| AuditLog            | `AuditLogModel`          | auditlogs             |
| 17| SystemConfig        | `SystemConfigModel`      | systemconfigs         |

---

## 2. Prisma Models (19)

Schema at `backend/prisma/schema.prisma` — mirrors all 17 Mongo models + 2 relational join tables:

| # | Prisma Model       | PG Table             | Notes                                    |
|---|--------------------|----------------------|------------------------------------------|
| 1 | User               | `users`              | All roles in single table                |
| 2 | PendingConnection  | `pending_connections`| Embedded array in Mongo → join table     |
| 3 | Brand              | `brands`             | Mirror of Brand.ts                       |
| 4 | Agency             | `agencies`           | Mirror of Agency.ts                      |
| 5 | MediatorProfile    | `mediator_profiles`  | Mirror of MediatorProfile.ts             |
| 6 | ShopperProfile     | `shopper_profiles`   | Mirror of ShopperProfile.ts              |
| 7 | Campaign           | `campaigns`          | Assignments stored as JSONB              |
| 8 | Deal               | `deals`              | Unique on (campaignId, mediatorCode)     |
| 9 | Order              | `orders`             | Events + verification as JSONB           |
| 10| OrderItem          | `order_items`        | Embedded array in Mongo → join table     |
| 11| Wallet             | `wallets`            | Unique on ownerUserId                    |
| 12| Transaction        | `transactions`       | Unique on idempotencyKey                 |
| 13| Payout             | `payouts`            | Unique on (provider, providerRef)        |
| 14| Invite             | `invites`            | Uses array as JSONB                      |
| 15| Ticket             | `tickets`            | Direct mirror                            |
| 16| PushSubscription   | `push_subscriptions` | Unique on endpoint                       |
| 17| Suspension         | `suspensions`        | Direct mirror                            |
| 18| AuditLog           | `audit_logs`         | Direct mirror                            |
| 19| SystemConfig       | `system_configs`     | Unique on key                            |
| 20| MigrationSync      | `migration_sync`     | PG-only, tracks backfill progress        |

---

## 3. Dual-Write Infrastructure

### `backend/services/dualWrite.ts` (819 lines)

17 exported functions — one per Mongoose model. Each maps Mongo doc → Prisma `upsert()` using `mongoId` as the idempotent key.

| Function                     | Prisma Model         | Key Mapping Details                                     |
|------------------------------|----------------------|---------------------------------------------------------|
| `dualWriteUser`              | `db.user`            | Embedded `pendingConnections[]` → separate PG table     |
| `dualWriteBrand`             | `db.brand`           | Direct field mapping                                    |
| `dualWriteAgency`            | `db.agency`          | Direct field mapping                                    |
| `dualWriteMediatorProfile`   | `db.mediatorProfile` | Resolves userId → PG UUID                               |
| `dualWriteShopperProfile`    | `db.shopperProfile`  | Resolves userId → PG UUID                               |
| `dualWriteCampaign`          | `db.campaign`        | Resolves brandUserId → PG UUID                          |
| `dualWriteDeal`              | `db.deal`            | Resolves campaignId → PG UUID                           |
| `dualWriteOrder`             | `db.order`           | Complex: items[] → `OrderItem` table, screenshots split |
| `dualWriteWallet`            | `db.wallet`          | Resolves ownerUserId → PG UUID                          |
| `dualWriteTransaction`       | `db.transaction`     | Resolves walletId → PG UUID, enum validation            |
| `dualWritePayout`            | `db.payout`          | Resolves beneficiaryUserId + walletId → PG UUIDs        |
| `dualWriteInvite`            | `db.invite`          | Resolves createdBy → PG UUID, uses[] as JSONB           |
| `dualWriteTicket`            | `db.ticket`          | Resolves userId → PG UUID                               |
| `dualWritePushSubscription`  | `db.pushSubscription`| Resolves userId → PG UUID, flattens keys obj            |
| `dualWriteSuspension`        | `db.suspension`      | Resolves targetUserId + adminUserId → PG UUIDs          |
| `dualWriteAuditLog`          | `db.auditLog`        | Resolves actorUserId → PG UUID (optional)               |
| `dualWriteSystemConfig`      | `db.systemConfig`    | Direct field mapping                                    |

### `backend/database/dualWriteHooks.ts` (~280 lines)

- Registers **post-hooks** on all 17 Mongoose models for automatic PG shadow writes.
- Hooks: `post('save')`, `post('findOneAndUpdate')`, `post('insertMany')`, `post('findOneAndDelete')`, `post('deleteOne')`, `post('updateOne')`, `post('deleteMany')` (warning only).
- **Feature-flagged**: `DUAL_WRITE_ENABLED` env var. All PG writes are fire-and-forget.
- **Exports**: `registerDualWriteHooks()`, `resyncAfterBulkUpdate(modelName, filter, limit)`.

---

## 4. Per-File Audit: Controllers

### 4.1 `controllers/adminController.ts` (624 lines)

**Models imported**: `UserModel`, `WalletModel`, `OrderModel`, `SuspensionModel`, `DealModel`, `CampaignModel`, `PayoutModel`, `SystemConfigModel`, `AuditLogModel`

**Also imports**: `resyncAfterBulkUpdate` from dualWriteHooks

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `SystemConfigModel.findOne().lean()` | Get system config |
| 2 | `SystemConfigModel.findOneAndUpdate()` (upsert) | Update system config |
| 3 | `UserModel.find().sort().limit().lean()` | List users |
| 4 | `WalletModel.find()` | List wallets |
| 5 | `UserModel.aggregate()` | Role counts pipeline |
| 6 | `OrderModel.aggregate()` | Statistics & growth pipeline |
| 7 | `DealModel.find().sort().limit().lean()` | List deals |
| 8 | `DealModel.findById().lean()` | Get single deal |
| 9 | `OrderModel.exists()` | Check if deal has orders |
| 10| `DealModel.updateOne()` | Soft-delete deal |
| 11| `UserModel.findById().lean()` | Get user detail |
| 12| `CampaignModel.exists()` | Suspension check |
| 13| `DealModel.exists()` | Suspension check |
| 14| `PayoutModel.exists()` | Suspension check |
| 15| `WalletModel.findOne().lean()` | Wallet lookup |
| 16| `WalletModel.findOneAndUpdate()` | Lock wallet balance |
| 17| `UserModel.findOneAndUpdate()` | Update user status |
| 18| `SuspensionModel.create()` | Create suspension record |
| 19| `DealModel.updateMany()` | Bulk deactivate deals |
| 20| `CampaignModel.updateMany()` | Bulk deactivate campaigns |
| 21| `AuditLogModel.find().sort().skip().limit().lean()` | Paginated audit logs |
| 22| `AuditLogModel.countDocuments()` | Audit log count |

**Approximate DB ops: ~22**

---

### 4.2 `controllers/authController.ts` (740 lines)

**Models imported**: `UserModel`, `InviteModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findById()` | Auth check |
| 2 | `UserModel.findOne().lean()` | Login by mobile/username |
| 3 | `InviteModel.findOne().session().lean()` | Invite lookup during registration |
| 4 | `UserModel.findOne().session().lean()` | Duplicate check during registration |
| 5 | `UserModel.exists().session()` | Username uniqueness check |
| 6 | `UserModel.create([...], {session})` | Create user (within transaction) |
| 7 | `UserModel.findOneAndUpdate()` | Reset failed login attempts |
| 8 | `UserModel.findOneAndUpdate()` | Lockout on failed attempts |
| 9 | `UserModel.findById().lean()` | Refresh token |
| 10| `UserModel.findByIdAndUpdate()` | Profile update |

**Uses Mongoose Transactions**: Yes (`mongoose.startSession()` + `session.withTransaction()` for registration)

**Approximate DB ops: ~10**

---

### 4.3 `controllers/brandController.ts` (878 lines)

**Models imported**: `UserModel`, `CampaignModel`, `OrderModel`, `DealModel`, `TransactionModel`

**Also imports**: `resyncAfterBulkUpdate` from dualWriteHooks

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findById().select().lean()` | Brand profile |
| 2 | `UserModel.find().sort().lean()` | List connected agencies |
| 3 | `CampaignModel.find().sort().lean()` | Brand campaigns |
| 4 | `OrderModel.find().sort().limit().lean()` | Brand orders |
| 5 | `TransactionModel.find().sort().limit().lean()` | Brand transactions |
| 6 | `UserModel.find().select().lean()` | Agency validation |
| 7 | `TransactionModel.findOneAndUpdate()` (upsert) | Idempotent payout |
| 8 | `UserModel.findById().select().lean()` | Payout validation |
| 9 | `UserModel.findOne()` | Brand connection lookup |
| 10| `UserModel.findOneAndUpdate()` ($push pendingConnections) | Connection request |
| 11| `UserModel.findOneAndUpdate()` ($addToSet connectedAgencies) | Accept connection |
| 12| `UserModel.findOneAndUpdate()` ($pull pendingConnections) | Reject connection |
| 13| `CampaignModel.create()` | Create campaign |
| 14| `CampaignModel.findById().select().lean()` | Get campaign |
| 15| `CampaignModel.findByIdAndUpdate()` | Update campaign |
| 16| `CampaignModel.findById().lean()` | Copy campaign |
| 17| `CampaignModel.create()` | Copy campaign |
| 18| `OrderModel.exists()` | Check campaign has orders |
| 19| `CampaignModel.updateOne()` | Soft-delete campaign |
| 20| `DealModel.updateMany()` | Cascade soft-delete deals |
| 21| `CampaignModel.updateMany()` ($pull cascade) | Remove brand from agencies |

**Approximate DB ops: ~21**

---

### 4.4 `controllers/inviteController.ts` (254 lines)

**Models imported**: `InviteModel`, `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `InviteModel.exists()` | Duplicate check |
| 2 | `InviteModel.create()` | Create invite |
| 3 | `InviteModel.find().sort().limit().lean()` | List invites |
| 4 | `InviteModel.findOne()` | Get invite |
| 5 | `invite.deleteOne()` | Delete invite |
| 6 | `UserModel.findById()` | Agency lookup for invite |
| 7 | `agency.save()` | Update agency codes |
| 8 | `UserModel.findById()` | Buyer invite lookup |

**Approximate DB ops: ~8**

---

### 4.5 `controllers/notificationsController.ts` (243 lines)

**Models imported**: `UserModel`, `OrderModel`, `PayoutModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `OrderModel.find().select().sort().limit().lean()` | Recent orders |
| 2 | `UserModel.countDocuments()` | User counts |
| 3 | `OrderModel.countDocuments()` | Order counts |
| 4 | `PayoutModel.find().select().sort().limit().lean()` | Recent payouts |

**Approximate DB ops: ~4**

---

### 4.6 `controllers/opsController.ts` (2779 lines) ⚠️ LARGEST FILE

**Models imported**: `UserModel`, `WalletModel`, `CampaignModel`, `OrderModel`, `TicketModel`, `DealModel`, `PayoutModel`, `TransactionModel`

**Also imports**: `resyncAfterBulkUpdate` from dualWriteHooks

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findOne()` | Brand connection lookup |
| 2 | `UserModel.findOneAndUpdate()` ($push pendingConnections) | Connection request |
| 3 | `UserModel.find().sort().skip().limit().lean()` | List mediators (paginated) |
| 4 | `WalletModel.find().lean()` | List wallets |
| 5 | `CampaignModel.find().sort().skip().limit().lean()` | List campaigns (paginated) |
| 6 | `DealModel.find().sort().skip().limit().lean()` | List deals (paginated) |
| 7 | `OrderModel.find().sort().skip().limit().lean()` | List orders (paginated) |
| 8 | `UserModel.find().sort().skip().limit().lean()` | List pending/verified users |
| 9 | `PayoutModel.find().sort().limit().lean()` | List payouts |
| 10| `UserModel.find().select().lean()` | User select |
| 11| `UserModel.findById().lean()` | User detail |
| 12| `UserModel.findByIdAndUpdate()` | Approve/reject mediator |
| 13| `UserModel.findByIdAndUpdate()` | Approve/reject user |
| 14| `OrderModel.findById()` | Get order for verification |
| 15| `order.save()` | Save order after verification |
| 16| `OrderModel.findById()` | Refresh order after verify |
| 17| `CampaignModel.findOneAndUpdate()` ($inc usedSlots: -1) | Release slot on rejection |
| 18| `OrderModel.findById()` | Request missing proof |
| 19| `order.save()` | Save missing proof request |
| 20| `OrderModel.findById()` | Settle order |
| 21| `UserModel.findById().select().lean()` | Buyer active check |
| 22| `TicketModel.exists()` | Open dispute check |
| 23| `order.save()` | Save frozen-disputed |
| 24| `CampaignModel.findById().lean()` | Campaign for settlement |
| 25| `OrderModel.countDocuments()` | Settled count for cap check |
| 26| `DealModel.findById().lean()` | Deal lookup for payout |
| 27| `UserModel.findOne()` | Mediator lookup for margin |
| 28| `WalletModel.findOneAndUpdate()` (via walletService) | Multiple wallet ops in session |
| 29| `TransactionModel.create()` (via walletService) | Transaction in session |
| 30| `order.save({session})` | Atomic order update |
| 31| `OrderModel.findById()` | Unsettle order |
| 32| `CampaignModel.findById().lean()` | Campaign for unsettlement |
| 33| `DealModel.findById().lean()` | Deal for unsettlement |
| 34| `UserModel.findOne()` | Mediator lookup for reversal |
| 35| `order.save({session})` | Atomic unsettle update |
| 36| `order.save()` | Non-wallet unsettle update |
| 37| `UserModel.findById().lean()` | Brand lookup for campaign creation |
| 38| `CampaignModel.create()` | Create campaign (privileged) |
| 39| `CampaignModel.create()` | Create campaign (self-owned) |
| 40| `CampaignModel.findById()` | Update campaign status |
| 41| `campaign.save()` | Save status update |
| 42| `DealModel.updateMany()` | Bulk activate/deactivate deals |
| 43| `CampaignModel.findById().select().lean()` | Delete campaign |
| 44| `OrderModel.exists()` | Check campaign has orders |
| 45| `CampaignModel.findOneAndUpdate()` | Soft-delete campaign |
| 46| `DealModel.updateMany()` | Cascade soft-delete deals |
| 47| `CampaignModel.findById()` | Assign slots |
| 48| `OrderModel.exists()` | Check campaign locked |
| 49| `UserModel.find().select().lean()` | Validate mediator codes |
| 50| `campaign.increment()` + `campaign.save()` | Optimistic concurrency save |
| 51| `CampaignModel.findById().lean()` | Publish deal |
| 52| `DealModel.findOne().lean()` | Check existing deal |
| 53| `DealModel.findOneAndUpdate()` | Update existing deal |
| 54| `DealModel.create()` | Create new deal |
| 55| `UserModel.findById()` | Payout mediator |
| 56| `PayoutModel.create([...], {session})` | Create payout in transaction |
| 57| `PayoutModel.findById().lean()` | Delete payout |
| 58| `UserModel.findById().lean()` | Beneficiary lookup |
| 59| `TransactionModel.exists()` | Check payout has ledger |
| 60| `PayoutModel.updateOne()` | Soft-delete payout |
| 61| `TransactionModel.find().sort().limit().lean()` | Get transactions |
| 62| `CampaignModel.findById().lean()` | Copy campaign |
| 63| `CampaignModel.create()` | Copy campaign |
| 64| `CampaignModel.findById().select().lean()` | Decline offer |
| 65| `CampaignModel.findOneAndUpdate()` ($pull allowedAgencyCodes) | Decline offer |

**Uses Mongoose Transactions**: Yes (settlement, unsettlement, payout — each wraps wallet+order ops)

**Approximate DB ops: ~65**

---

### 4.7 `controllers/ordersController.ts` (930 lines)

**Models imported**: `UserModel`, `CampaignModel`, `DealModel`, `OrderModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `OrderModel.findById().lean()` | Get order |
| 2 | `OrderModel.findOne().lean()` (by externalOrderId) | Get order by external ID |
| 3 | `OrderModel.find().sort().limit().lean()` | List user orders |
| 4 | `UserModel.findById().lean()` | User validation |
| 5 | `OrderModel.countDocuments()` | Velocity limit check |
| 6 | `OrderModel.exists()` | Duplicate check |
| 7 | `OrderModel.findOne()` | Duplicate deal check |
| 8 | `CampaignModel.findOne().session()` | Campaign lookup in transaction |
| 9 | `UserModel.findOne().select().lean()` | Mediator/agency lookup |
| 10| `DealModel.findById().lean()` | Deal lookup |
| 11| `CampaignModel.findOneAndUpdate()` ($inc slots, session) | Atomic slot claim |
| 12| `OrderModel.findOne().session()` | Pre-order upgrade check |
| 13| `order.save({session})` | Save pre-order upgrade |
| 14| `OrderModel.create([...], {session})` | Create order in transaction |
| 15| `order.save()` | Save proof event |
| 16| `OrderModel.findById()` | Submit claim (proof upload) |
| 17| `UserModel.findById().select().lean()` | AI rating buyer name |
| 18| `order.save()` | Save claim/proof |
| 19| `UserModel.findOne().select().lean()` | Mediator lookup for audience |

**Uses Mongoose Transactions**: Yes (`mongoose.startSession()` + `session.withTransaction()` for createOrder)

**Approximate DB ops: ~19**

---

### 4.8 `controllers/productsController.ts` (200 lines)

**Models imported**: `DealModel`, `OrderModel`, `CampaignModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `DealModel.find().sort().limit().lean()` | List deals |
| 2 | `DealModel.findOne().lean()` | Get deal |
| 3 | `CampaignModel.findById().select().lean()` | Campaign lookup |
| 4 | `OrderModel.create()` | Create order |

**Approximate DB ops: ~4**

---

### 4.9 `controllers/ticketsController.ts` (344 lines)

**Models imported**: `TicketModel`, `OrderModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `TicketModel.find().sort().limit().lean()` | List tickets |
| 2 | `OrderModel.find().select().sort().limit().lean()` | Scope resolution |
| 3 | `OrderModel.findById().select().lean()` | Access check |
| 4 | `TicketModel.create()` | Create ticket |
| 5 | `TicketModel.findById().lean()` | Get ticket |
| 6 | `TicketModel.findByIdAndUpdate()` | Update ticket |
| 7 | `TicketModel.findByIdAndUpdate()` | Soft-delete ticket |

**Approximate DB ops: ~7**

---

### 4.10 `controllers/pushNotificationsController.ts` (200 lines)

**Models imported**: `PushSubscriptionModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `PushSubscriptionModel.findOneAndUpdate()` (upsert) | Subscribe |
| 2 | `PushSubscriptionModel.deleteOne()` | Unsubscribe |

**Approximate DB ops: ~2**

---

## 5. Per-File Audit: Services

### 5.1 `services/audit.ts` (~40 lines)

**Models imported**: `AuditLogModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `AuditLogModel.create()` | Write audit log |

Also calls `dualWriteAuditLog()` fire-and-forget.

**Approximate DB ops: ~1**

---

### 5.2 `services/walletService.ts` (~240 lines)

**Models imported**: `WalletModel`, `TransactionModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `WalletModel.findOneAndUpdate()` (upsert) | `ensureWallet` — concurrency-safe creation |
| 2 | `WalletModel.findOne()` | Fallback on E11000 race |
| 3 | `TransactionModel.findOne().read('primary').session()` | Idempotency check (credit) |
| 4 | `WalletModel.findOneAndUpdate()` (upsert, $inc, session) | Apply credit |
| 5 | `TransactionModel.create([...], {session})` | Create credit transaction |
| 6 | `WalletModel.findOne().lean()` | Post-credit dual-write read |
| 7 | `TransactionModel.findOne().read('primary').session()` | Idempotency check (debit) |
| 8 | `WalletModel.findOneAndUpdate()` ($inc negative, session) | Apply debit with balance check |
| 9 | `WalletModel.findOne().session()` | Check wallet exists (insufficient funds) |
| 10| `TransactionModel.create([...], {session})` | Create debit transaction |
| 11| `WalletModel.findOne().lean()` | Post-debit dual-write read |

Also calls `dualWriteWallet()` + `dualWriteTransaction()` fire-and-forget.

**Uses Mongoose Transactions**: Yes (internal sessions when no external session provided)

**Approximate DB ops: ~11**

---

### 5.3 `services/orderWorkflow.ts` (~180 lines)

**Models imported**: `OrderModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `OrderModel.findOneAndUpdate()` (conditional, session) | Transition order workflow state |
| 2 | `OrderModel.findById().select().lean()` | Fallback error detail |
| 3 | `OrderModel.updateMany()` | `freezeOrders` — bulk freeze |
| 4 | `OrderModel.findOneAndUpdate()` | `reactivateOrder` — unfreeze single |

Also calls `dualWriteOrder()` + `resyncAfterBulkUpdate('Order', ...)` fire-and-forget.

**Approximate DB ops: ~4**

---

### 5.4 `services/invites.ts` (~150 lines)

**Models imported**: `InviteModel`, `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findById().session().lean()` | `ensureActiveUserById` |
| 2 | `UserModel.findOne().session().lean()` | `ensureActiveUserByCode` |
| 3 | `InviteModel.findOne().session().lean()` | Invite snapshot for consumption |
| 4 | `InviteModel.findOneAndUpdate()` (session: undefined) | Mark expired invite |
| 5 | `InviteModel.findOneAndUpdate()` (aggregation pipeline, session) | Atomic consume invite |
| 6 | `InviteModel.findOne()` | Revoke invite lookup |
| 7 | `invite.save()` | Save revoked invite |

**Approximate DB ops: ~7**

---

### 5.5 `services/lineage.ts` (~40 lines)

**Models imported**: `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.find().select().lean()` | `listMediatorCodesForAgency` |
| 2 | `UserModel.findOne().select().lean()` | `getAgencyCodeForMediatorCode` |
| 3 | `UserModel.findOne().select().lean()` | `isAgencyActive` |
| 4 | `UserModel.findOne().select().lean()` | `isMediatorActive` |

**Approximate DB ops: ~4**

---

### 5.6 `services/roleDocuments.ts` (~100 lines)

**Models imported**: `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `AgencyModel.findOneAndUpdate()` (upsert, session) | Ensure agency document |
| 2 | `BrandModel.findOneAndUpdate()` (upsert, session) | Ensure brand document |
| 3 | `MediatorProfileModel.findOneAndUpdate()` (upsert, session) | Ensure mediator profile |
| 4 | `ShopperProfileModel.findOneAndUpdate()` (upsert, session) | Ensure shopper profile |

Also calls `dualWriteAgency()`, `dualWriteBrand()`, `dualWriteMediatorProfile()`, `dualWriteShopperProfile()` fire-and-forget.

**Approximate DB ops: ~4**

---

### 5.7 `services/pushNotifications.ts` (~165 lines)

**Models imported**: `PushSubscriptionModel`, `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `PushSubscriptionModel.find().select().lean()` | Get user subscriptions |
| 2 | `PushSubscriptionModel.deleteOne()` | Remove invalid subscription |
| 3 | `UserModel.find().select().lean()` | Find mediators for push notification |

**Approximate DB ops: ~3**

---

### 5.8 `services/orderEvents.ts` (~45 lines)

**Models imported**: None (pure utility functions)

No DB operations. Provides `pushOrderEvent()` and `isTerminalAffiliateStatus()` helpers.

---

### 5.9 `services/realtimeHub.ts` (~40 lines)

**Models imported**: None (EventEmitter only)

No DB operations. Provides `publishRealtime()`, `publishBroadcast()`, `subscribeRealtime()`.

---

### 5.10 `services/tokens.ts` (~20 lines)

**Models imported**: None (JWT only)

No DB operations. Provides `signAccessToken()`, `signRefreshToken()`.

---

### 5.11 `services/passwords.ts` (~25 lines)

**Models imported**: None (bcrypt only)

No DB operations. Provides `hashPassword()`, `verifyPassword()`.

---

### 5.12 `services/codes.ts` (~6 lines)

**Models imported**: None (crypto only)

No DB operations. Provides `generateHumanCode()`.

---

### 5.13 `services/authz.ts` (~28 lines)

**Models imported**: None (pure logic)

No DB operations. Provides `getRequester()`, `isPrivileged()`, `requireAnyRole()`, `requireSelfOrPrivileged()`.

---

### 5.14 `services/sheetsService.ts` (388 lines)

**Models imported**: None

No DB operations. Pure Google Sheets/Drive REST API integration.

---

### 5.15 `services/aiService.ts` (3510 lines)

**Models imported**: None

No DB operations. Gemini AI + Tesseract OCR for proof verification. The largest service file but purely external API calls + image processing.

---

### 5.16 `services/dualWrite.ts` (819 lines)

Covered in [Section 3](#3-dual-write-infrastructure). Uses **Prisma** (not Mongoose) for all operations.

---

## 6. Per-File Audit: Middleware

### 6.1 `middleware/auth.ts` (~165 lines)

**Models imported**: `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findById().select().lean()` | Resolve user from JWT (every authenticated request) |
| 2 | `UserModel.findOne().select().lean()` | Check upstream agency (for mediator) |
| 3 | `UserModel.findOne().select().lean()` | Check upstream mediator (for shopper) |
| 4 | `UserModel.findOne().select().lean()` | Check upstream agency (for shopper's mediator) |

**⚠️ HIGH FREQUENCY**: This middleware runs on **every authenticated API request**, performing 1-3 DB queries per request for zero-trust role resolution.

**Approximate DB ops per request: 1–4**

---

### 6.2 `middleware/errors.ts`

**Models imported**: None

No DB operations. Pure error class definition + Express error handler.

---

## 7. Per-File Audit: Seeds

### 7.1 `seeds/seed.ts` (605 lines) — Large Seed

**Models imported**: `UserModel`, `WalletModel`, `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`, `CampaignModel`, `DealModel`, `OrderModel`, `TicketModel`, `PayoutModel`, `TransactionModel`, `InviteModel`, `AuditLogModel`, `SuspensionModel` **(15 of 17 models)**

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `*.deleteMany({})` × 15 | Wipe all collections |
| 2 | `UserModel.create()` × N | Create users (admin, agencies, brands, mediators, shoppers) |
| 3 | `AgencyModel.create()` × N | Create agency docs |
| 4 | `MediatorProfileModel.create()` × N | Create mediator profiles |
| 5 | `BrandModel.create()` × N | Create brand docs |
| 6 | `ShopperProfileModel.create()` × N | Create shopper profiles |
| 7 | `CampaignModel.create()` × N | Create campaigns |
| 8 | `DealModel.updateOne()` (upsert) × N | Create deals |
| 9 | `DealModel.find().limit().lean()` | Index deals for orders |
| 10| `OrderModel.create()` × N | Create orders |
| 11| `UserModel.findById().lean()` × N | Buyer lookup for tickets |
| 12| `TicketModel.create()` × N | Create tickets |
| 13| `PayoutModel.create()` × N | Create payouts |

Also uses `applyWalletCredit()` and `ensureWallet()` extensively.

**Approximate DB ops: 15 (wipe) + O(usersPerRole × 5) creation ops**

---

### 7.2 `seeds/admin.ts` (~95 lines) — Admin-Only Seed

**Models imported**: `UserModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findOne()` | Find by username |
| 2 | `UserModel.findOne()` | Find by mobile |
| 3 | `UserModel.findOne().lean()` | Check username conflict |
| 4 | `new UserModel()` + `user.save()` | Create or update admin |

**Approximate DB ops: ~4**

---

### 7.3 `seeds/dev.ts` (~230 lines) — Dev Seed

**Models imported**: `UserModel`, `WalletModel`, `CampaignModel`, `DealModel`

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `UserModel.findOne()` × 4 | Upsert users by mobile |
| 2 | `user.save()` × 4 | Save user docs |
| 3 | `WalletModel.findOneAndUpdate()` (upsert) | Ensure brand wallet |
| 4 | `wallet.save()` | Update wallet balance |
| 5 | `CampaignModel.findOne().lean()` | Check existing campaign |
| 6 | `CampaignModel.create()` | Create campaign |
| 7 | `DealModel.findOne().lean()` | Check existing deal |
| 8 | `DealModel.create()` | Create deal |

Also calls `ensureRoleDocumentsForUser()` (which does `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel` upserts).

**Approximate DB ops: ~12 + 4 role document upserts**

---

### 7.4 `seeds/e2e.ts` (~240 lines) — E2E Seed

**Models imported**: `UserModel`, `WalletModel`, `AgencyModel`, `BrandModel`, `MediatorProfileModel`, `ShopperProfileModel`, `CampaignModel`, `DealModel`, `OrderModel`, `TicketModel`, `InviteModel`, `TransactionModel`, `PayoutModel` **(13 models)**

| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `*.deleteMany({})` × 13 | Wipe collections |
| 2 | `UserModel.create()` × 6 | Create test users |
| 3 | `WalletModel.findOneAndUpdate()` (upsert) | Pre-fund brand wallet |
| 4 | `CampaignModel.create()` | Create campaign |
| 5 | `DealModel.create()` | Create deal |

Also calls `ensureRoleDocumentsForUser()` × 5.

**Approximate DB ops: 13 (wipe) + ~11 creation + 5 × ~4 role doc upserts = ~44**

---

## 8. Per-File Audit: Database Infrastructure

### 8.1 `database/dualWriteHooks.ts` (~280 lines)

**Models imported**: All 17 Mongoose models

Uses `model.schema.post()` to register hooks. No direct query operations — hooks fire on existing Mongoose operations.

Also exports `resyncAfterBulkUpdate()` which does:
| # | Operation | Line Context |
|---|-----------|-------------|
| 1 | `model.find(filter).limit().lean()` | Re-read docs after bulk update for PG resync |

---

## 9. Aggregate Statistics

### DB Operations by Model (approximate)

| Model              | Total Occurrences | Highest-Frequency Files                        |
|--------------------|-------------------|------------------------------------------------|
| **UserModel**      | ~45               | auth, ops, middleware/auth, lineage, seeds     |
| **OrderModel**     | ~30               | ops, orders, orderWorkflow                     |
| **CampaignModel**  | ~25               | ops, brand, seeds                              |
| **DealModel**      | ~18               | ops, brand, admin, seeds                       |
| **WalletModel**    | ~12               | walletService, admin, ops, seeds               |
| **TransactionModel**| ~10              | walletService, brand, ops                      |
| **InviteModel**    | ~10               | invites service, auth, invite controller        |
| **PayoutModel**    | ~8                | ops, notifications, seeds                      |
| **TicketModel**    | ~7                | tickets controller, ops                        |
| **AuditLogModel**  | ~3                | audit service, admin                           |
| **PushSubscriptionModel** | ~4         | pushNotifications controller/service           |
| **AgencyModel**    | ~3                | roleDocuments, seeds                           |
| **BrandModel**     | ~3                | roleDocuments, seeds                           |
| **MediatorProfileModel** | ~3          | roleDocuments, seeds                           |
| **ShopperProfileModel** | ~3           | roleDocuments, seeds                           |
| **SuspensionModel**| ~2                | admin controller, seeds                        |
| **SystemConfigModel** | ~2             | admin controller                               |

### DB Operations by Mongoose Method

| Method                    | Count | Notes                                          |
|---------------------------|-------|-------------------------------------------------|
| `find()`                  | ~35   | Most common read pattern                        |
| `findOne()`               | ~25   | Single doc reads                                |
| `findById()`              | ~20   | By ObjectId                                     |
| `findOneAndUpdate()`      | ~20   | Atomic update-and-return                        |
| `findByIdAndUpdate()`     | ~8    | By ObjectId update                              |
| `create()`                | ~25   | Inserts (some with session)                     |
| `save()`                  | ~15   | Instance saves                                  |
| `exists()`                | ~8    | Boolean existence checks                        |
| `countDocuments()`        | ~6    | Count queries                                   |
| `updateOne()`             | ~4    | Single update without return                    |
| `updateMany()`            | ~10   | Bulk updates (deal/campaign cascades)           |
| `deleteMany()`            | ~15   |  Seeds only (wipe)                              |
| `deleteOne()`             | ~3    | Single doc deletion                             |
| `aggregate()`             | ~3    | Admin dashboard stats                           |
| `.lean()`                 | ~50+  | Used on most reads for performance              |

---

## 10. Mongoose Transaction Usage

Transactions use `mongoose.startSession()` + `session.withTransaction()`:

| File | Function | Purpose | Models in Transaction |
|------|----------|---------|-----------------------|
| `authController.ts` | `register` | User creation + invite consumption | `UserModel`, `InviteModel` |
| `ordersController.ts` | `createOrder` | Order creation + slot claiming | `OrderModel`, `CampaignModel` |
| `opsController.ts` | `settleOrderPayment` | Wallet debit/credit + order status | `WalletModel`, `TransactionModel`, `OrderModel` |
| `opsController.ts` | `unsettleOrderPayment` | Reverse wallet moves + order reset | `WalletModel`, `TransactionModel`, `OrderModel` |
| `opsController.ts` | `payoutMediator` | Payout creation + wallet debit | `PayoutModel`, `WalletModel`, `TransactionModel` |
| `walletService.ts` | `applyWalletCredit` | Atomic credit + transaction | `WalletModel`, `TransactionModel` |
| `walletService.ts` | `applyWalletDebit` | Atomic debit + transaction | `WalletModel`, `TransactionModel` |

**⚠️ Migration Risk**: All 7 transaction boundaries must be preserved or replaced with PostgreSQL transactions when migrating.

---

## 11. Migration Risk Matrix

### 🔴 HIGH RISK (complex, transaction-dependent, high-frequency)

| Area | Risk | Details |
|------|------|---------|
| **middleware/auth.ts** | Latency-critical | Runs on every request; 1-4 queries. Must be cached or optimized in PG. |
| **Settlement flow** (opsController) | Transaction atomicity | 3-party wallet movements (brand debit → buyer credit → mediator credit) in MongoDB session. Must map to PG transaction. |
| **Unsettlement flow** | Transaction atomicity | Reverse settlement with same 3-party atomicity requirement. |
| **Order creation** (ordersController) | Transaction + slot claiming | `CampaignModel.findOneAndUpdate($inc)` for atomic slot decrement within session. |
| **Wallet service** | Idempotency + transactions | `TransactionModel` idempotency key + `WalletModel` optimistic concurrency. |
| **Invite consumption** | Aggregation pipeline update | Uses `findOneAndUpdate` with `$set` via aggregation pipeline (`updatePipeline: true`) for atomic consume. |

### 🟡 MEDIUM RISK (bulk operations, non-trivial queries)

| Area | Risk | Details |
|------|------|---------|
| **Admin aggregations** | `UserModel.aggregate()`, `OrderModel.aggregate()` | Dashboard stats pipelines need PG equivalent (GROUP BY). |
| **Bulk updateMany** | `DealModel.updateMany()`, `CampaignModel.updateMany()` | Cascade operations on campaign status/deletion. Need PG transaction or batch. |
| **resyncAfterBulkUpdate** | Post-bulk PG sync | Currently re-reads all affected docs after bulk update. PG-primary eliminates this. |
| **Order embedded arrays** | `items[]`, `events[]`, `missingProofRequests[]` | Already mapped to `OrderItem` table + JSONB. Need to verify all push/pull patterns. |
| **User embedded arrays** | `connectedAgencies[]`, `pendingConnections[]`, `generatedCodes[]` | `$push`, `$pull`, `$addToSet` operations need PG array ops or join tables. |

### 🟢 LOW RISK (simple CRUD, already well-mapped)

| Area | Risk | Details |
|------|------|---------|
| **Tickets** | Simple CRUD | `create`, `findById`, `findByIdAndUpdate` only. |
| **PushSubscriptions** | Simple upsert + delete | `findOneAndUpdate(upsert)`, `deleteOne`. |
| **Suspensions** | Write-once | `create()` only. |
| **SystemConfig** | Singleton | `findOne()`, `findOneAndUpdate(upsert)`. |
| **AuditLog** | Append-only | `create()` + paginated `find()`. |
| **Role documents** (Agency, Brand, MediatorProfile, ShopperProfile) | Upsert-only | `findOneAndUpdate(upsert)` pattern. |

---

## Summary

- **17 Mongoose models** in use across the backend
- **19 Prisma models** (17 mirrors + 2 join tables: `PendingConnection`, `OrderItem`)
- **~200+ distinct DB operation call sites** across all files
- **7 transaction boundaries** that must be preserved
- **Dual-write hooks** already shadow every Mongoose write to PostgreSQL
- **middleware/auth.ts** is the single highest-frequency DB consumer (every request)
- **opsController.ts** is the most complex file (2779 lines, ~65 DB ops, 3 transaction flows)

The dual-write infrastructure (`dualWrite.ts` + `dualWriteHooks.ts`) already handles the Mongo→PG mapping for all 17 models. Migration to PG-primary would involve:
1. Reversing the write direction (PG-primary, Mongo-shadow)
2. Replacing all Mongoose queries with Prisma queries
3. Replacing MongoDB transactions with PostgreSQL transactions
4. Replacing `$push`/`$pull`/`$addToSet` array operators with PG array ops or join tables
5. Replacing MongoDB aggregation pipelines with SQL GROUP BY queries
