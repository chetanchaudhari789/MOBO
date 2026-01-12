# Domain Model (Current Implementation)

This document summarizes the current backend domain entities and how they relate. It is meant to be an “as built” map, not a final product spec.

## Core entities

### User

Source: [backend/models/User.ts](../backend/models/User.ts)

Roles:

- `shopper` (buyer)
- `mediator`
- `agency`
- `brand`
- `ops`
- `admin`

Key linkage fields:

- `mediatorCode`: stable code for `agency` and `mediator` users.
- `parentCode`:
  - for `mediator`: the parent agency’s `mediatorCode`
  - for `shopper`: the parent mediator’s `mediatorCode`
- `brandCode`: stable code for brand connection requests.
- Brand connection state:
  - `pendingConnections[]` (agencyCode + timestamp)
  - `connectedAgencies[]` (agency codes)

Status & enforcement:

- `status`: `active|suspended|pending`
- Backend auth middleware enforces upstream suspension:
  - shopper depends on mediator + agency
  - mediator depends on agency

### Invite

Source: [backend/models/Invite.ts](../backend/models/Invite.ts)

- `code`: used for registration
- `role`: role to be created (must match)
- `parentCode`: code of upstream parent (mediator for shopper invites; agency for mediator invites)
- `status`: `active|used|revoked|expired`
- Supports `maxUses` with usage log (`uses[]`).

### Campaign

Source: [backend/models/Campaign.ts](../backend/models/Campaign.ts)

Represents a brand-owned offer “template” that can be distributed to agencies/mediators.

Key fields:

- Ownership: `brandUserId` + `brandName`
- Visibility:
  - `allowedAgencyCodes[]` (agencies allowed to see the campaign)
  - `assignments` map: `mediatorCode -> { limit, payout? }`
- Economics:
  - `pricePaise`, `originalPricePaise`, `payoutPaise`
- Capacity:
  - `totalSlots`, `usedSlots`
- Immutability:
  - `locked` + `lockedReason` (locked after slot assignment or after first order; status-only updates remain allowed)

### Deal

Source: [backend/models/Deal.ts](../backend/models/Deal.ts)

A published, mediator-scoped offer derived from a campaign.

- Uniqueness: one deal per `(campaignId, mediatorCode)`
- Snapshots campaign fields to remain stable.
- Economics:
  - `commissionPaise` (buyer commission)
  - `payoutPaise` (total payout allocated to mediator via agency; margin is `payoutPaise - commissionPaise`)

### Order

Source: [backend/models/Order.ts](../backend/models/Order.ts)

Represents a buyer claiming a deal/campaign.

Key linkages:

- Buyer: `userId`
- Brand (for filtering): `brandUserId`
- Mediator attribution: `managerName` stores mediatorCode
- Items:
  - `items[0].campaignId`
  - `items[0].productId` is typically the `Deal` id

State:

- Strict workflow `workflowStatus` (state machine enforced in services)
- Business statuses:
  - `affiliateStatus` (Unchecked/Pending_Cooling/Approved_Settled/Rejected/Fraud_Alert/Cap_Exceeded/Frozen_Disputed)
  - `paymentStatus` (Pending/Paid/Refunded/Failed)

Anti-fraud / uniqueness:

- Unique `externalOrderId` when provided (system-wide).
- Unique `(userId, items.0.productId)` for non-terminal workflows (prevents duplicate deal claims).

### Ticket

Source: [backend/models/Ticket.ts](../backend/models/Ticket.ts)

- Created by any authenticated user.
- Can optionally reference an order by `orderId` (string).
- Used to freeze settlement when open disputes exist.

### Wallet / Transaction / Payout

Sources:

- [backend/models/Wallet.ts](../backend/models/Wallet.ts)
- [backend/models/Transaction.ts](../backend/models/Transaction.ts)
- [backend/models/Payout.ts](../backend/models/Payout.ts)

- Wallet represents balances (currently only `availablePaise` is actively mutated in code paths found).
- Transaction is the idempotent ledger for mutations (unique `idempotencyKey`).
- Payout represents a withdrawal request/result; current ops flow records payouts as manual and debits wallet.

### AuditLog

Source: [backend/models/AuditLog.ts](../backend/models/AuditLog.ts)

Append-only record of actor/action/entity/metadata; used across invites, approvals, payouts, campaign actions, etc.

## High-level relationship diagram (text)

- Agency (`User.roles=agency`, has `mediatorCode=AGY...`)

  - creates mediator invites
  - owns mediators via `mediator.parentCode == agency.mediatorCode`

- Mediator (`User.roles=mediator`, has `mediatorCode=MED...`)

  - creates buyer invites
  - owns buyers via `shopper.parentCode == mediator.mediatorCode`
  - publishes deals for a campaign (one per mediator)

- Brand (`User.roles=brand`, has `brandCode=BRD...`)

  - connects to agencies (via `connectedAgencies[]`)
  - owns campaigns (`Campaign.brandUserId == brand._id`)
  - views orders by `brandUserId` (with legacy fallback by brand name)

- Buyer (`User.roles=shopper`)
  - sees deals only for their mediator
  - creates orders against campaigns available to their lineage (agency allow list or explicit mediator assignment)
