# MOBO UI-driven API Contract (v1)

Date: 2026-01-08

This document captures the API contract implied by the current UI (frontend is treated as final) and the corresponding backend routes.

## Conventions

### Base URL

- The UI resolves the base URL from (first match wins):
  - `globalThis.__MOBO_API_URL__`
  - `VITE_API_URL`
  - `NEXT_PUBLIC_API_URL`
  - fallback: `/api`

### Next.js apps rewrite

- The Next.js apps in `apps/*` rewrite `/api/:path*` to the backend base URL (see `apps/*/next.config.js`).
- This means the UI generally calls `/api/...` even when deployed separately.

### Auth

- Authenticated requests send `Authorization: Bearer <accessToken>`.
- `accessToken` and optional `refreshToken` are persisted by the UI in localStorage key `mobo_tokens_v1`.

### Errors

Backend errors are returned as:

```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

### Canonical UI shapes

These are the canonical shapes returned by the backend mappers (`toUiUser`, `toUiDeal`, `toUiOrder`, `toUiTicket`).

#### `User`

```json
{
  "id": "...",
  "name": "...",
  "mobile": "...",
  "email": "...",
  "role": "user|mediator|agency|brand|admin",
  "status": "active|suspended|pending",
  "mediatorCode": "...",
  "parentCode": "...",
  "generatedCodes": [],
  "brandCode": "...",
  "connectedAgencies": [],
  "pendingConnections": [
    { "agencyId": "...", "agencyName": "...", "agencyCode": "...", "timestamp": "..." }
  ],
  "walletBalance": 0,
  "walletPending": 0
}
```

#### `Deal` (returned from `GET /products` and `GET /admin/products`)

```json
{
  "id": "...",
  "title": "...",
  "description": "...",
  "price": 0,
  "originalPrice": 0,
  "commission": 0,
  "image": "...",
  "productUrl": "...",
  "platform": "...",
  "dealType": "...",
  "brandName": "...",
  "mediatorCode": "...",
  "campaignId": "...",
  "active": true
}
```

#### `Order`

```json
{
  "id": "...",
  "userId": "...",
  "items": [
    {
      "productId": "...",
      "title": "...",
      "priceAtPurchase": 0,
      "commission": 0,
      "campaignId": "...",
      "dealType": "...",
      "quantity": 1
    }
  ],
  "total": 0,
  "status": "...",
  "workflowStatus": "...",
  "paymentStatus": "...",
  "affiliateStatus": "...",
  "externalOrderId": "...",
  "screenshots": {},
  "reviewLink": "...",
  "managerName": "...",
  "agencyName": "...",
  "buyerName": "...",
  "buyerMobile": "...",
  "brandName": "...",
  "createdAt": "..."
}
```

#### `Ticket`

```json
{
  "id": "...",
  "userId": "...",
  "userName": "...",
  "role": "...",
  "orderId": "...",
  "issueType": "...",
  "description": "...",
  "status": "Open|Resolved|Rejected",
  "createdAt": "..."
}
```

## UI Screens → API usage (shared/pages)

- [shared/pages/AdminPortal.tsx](shared/pages/AdminPortal.tsx)

  - `api.admin.getUsers(role)`
  - `api.admin.getFinancials()`
  - `api.admin.getProducts()`
  - `api.admin.getStats()`
  - `api.admin.getGrowthAnalytics()`
  - `api.admin.getInvites()`
  - `api.admin.generateInvite(role,label)`
  - `api.admin.updateUserStatus(userId,status)`
  - `api.tickets.getAll()`
  - `api.tickets.update(id,status)`

- [shared/pages/AgencyDashboard.tsx](shared/pages/AgencyDashboard.tsx)

  - `api.auth.updateProfile(userId, updates)`
  - `api.ops.requestBrandConnection(brandCode)`
  - `api.ops.getMediators(agencyCode)`
  - `api.ops.getCampaigns(mediatorCode?)`
  - `api.ops.getMediatorOrders(mediatorCode, role?)`
  - `api.ops.getAgencyLedger()`
  - `api.ops.generateMediatorInvite(agencyId)`
  - `api.ops.approveMediator(id)`
  - `api.ops.assignSlots(id, assignments, dealType?, price?, payout?)`
  - `api.ops.createCampaign(data)`
  - `api.ops.settleOrderPayment(orderId)`
  - `api.ops.verifyOrderClaim(orderId)`
  - `api.ops.payoutMediator(mediatorId, amount)`

- [shared/pages/BrandDashboard.tsx](shared/pages/BrandDashboard.tsx)

  - `api.brand.getBrandCampaigns(brandId)`
  - `api.brand.getConnectedAgencies(brandId)`
  - `api.brand.getBrandOrders(brandName)`
  - `api.brand.getTransactions(brandId)`
  - `api.brand.payoutAgency(brandId, agencyId, amount, ref)`
  - `api.brand.resolveConnectionRequest(brandId, agencyCode, action)`
  - `api.brand.removeAgency(brandId, agencyCode)`
  - `api.brand.createCampaign(data)`
  - `api.brand.updateCampaign(campaignId, data)`

- [shared/pages/MediatorDashboard.tsx](shared/pages/MediatorDashboard.tsx)

  - `api.ops.getMediatorOrders(mediatorCode, role?)`
  - `api.ops.getCampaigns(mediatorCode?)`
  - `api.ops.getPendingUsers(code)`
  - `api.ops.getVerifiedUsers(code)`
  - `api.ops.approveUser(id)`
  - `api.ops.rejectUser(id)`
  - `api.ops.publishDeal(id, commission, mediatorCode)`
  - `api.ops.settleOrderPayment(orderId)`
  - `api.ops.verifyOrderClaim(orderId)`
  - `api.ops.analyzeProof(orderId, imageBase64, expectedOrderId, expectedAmount)`
  - `api.tickets.getAll()`

- [shared/pages/Explore.tsx](shared/pages/Explore.tsx)

  - `api.products.getAll(mediatorCode?)`

- [shared/pages/Orders.tsx](shared/pages/Orders.tsx)

  - `api.products.getAll()`
  - `api.orders.getUserOrders(userId)`
  - `api.orders.create(userId, items, metadata)`
  - `api.orders.submitClaim(orderId, proof)`
  - `api.orders.extractDetails(file)` (UI-only stub; not a backend call)
  - `api.tickets.create(data)`

- [shared/pages/Profile.tsx](shared/pages/Profile.tsx)

  - `api.orders.getUserOrders(userId)`

- [shared/pages/Auth.tsx](shared/pages/Auth.tsx)
  - `api.auth.login(mobile,password)`

## UI Components/Context → API usage

- [shared/context/AuthContext.tsx](shared/context/AuthContext.tsx)

  - `api.auth.me()`
  - `api.auth.login(mobile,password)`
  - `api.auth.register(name,mobile,password,mediatorCode)`
  - `api.auth.registerOps(name,mobile,password,role,code)`
  - `api.auth.registerBrand(name,mobile,password,brandCode)`
  - `api.auth.updateProfile(userId, updates)`

- [shared/components/Chatbot.tsx](shared/components/Chatbot.tsx)

  - `api.products.getAll(mediatorCode?)`
  - `api.orders.getUserOrders(userId)`
  - `api.tickets.getAll()`
  - `api.chat.sendMessage(message,userId,userName,products,orders,tickets,image?)`

## API Endpoints

### Auth (`/auth/*`)

#### `POST /auth/login`

- Request:
  - `{ "mobile": string, "password": string }`
- Response (200):
  - `{ "user": User, "tokens": { "accessToken": string, "refreshToken": string } }`

#### `POST /auth/register`

- Buyer registration is invite-based.
- Request:
  - `{ "name": string, "mobile": string, "password": string, "mediatorCode": string, "email"?: string }`
- Response (201):
  - `{ "user": User, "tokens": { "accessToken": string, "refreshToken": string } }`

#### `POST /auth/register-ops`

- Agency/Mediator/Ops registration is invite-based.
- Request:
  - `{ "name": string, "mobile": string, "password": string, "role": "agency"|"mediator"|"ops"|"admin", "code": string }`
- Response (201):
  - `{ "user": User, "tokens": { "accessToken": string, "refreshToken": string } }`

#### `POST /auth/register-brand`

- Brand registration is invite-based.
- UI label is `brandCode`, but it is treated as an invite code.
- Request:
  - `{ "name": string, "mobile": string, "password": string, "brandCode": string }`
- Response (201):
  - `{ "user": User, "tokens": { "accessToken": string, "refreshToken": string } }`

#### `GET /auth/me`

- Auth required.
- Response (200):
  - `{ "user": User }`

#### `PATCH /auth/profile`

- Auth required.
- Request:
  - `{ "userId": string, ...Partial<User> }`
- Response (200):
  - `{ "user": User }`

### Ops (`/ops/*`)

All ops endpoints require auth and one of roles: `agency | mediator | ops | admin`.

#### `POST /ops/brands/connect`

- Agency initiates a Brand connection request.
- Request:
  - `{ "brandCode": string }`
- Response (200):
  - Implementation-defined JSON (UI treats non-2xx as failure).

#### `GET /ops/mediators?agencyCode=...`

- Response: array of mediator users.

#### `GET /ops/campaigns?mediatorCode=...`

- Response: array of `Campaign`.

#### `GET /ops/orders?mediatorCode=...&role=...`

- Response: array of `Order`.

#### `GET /ops/users/pending?code=...`

- Response: array of users pending verification.

#### `GET /ops/users/verified?code=...`

- Response: array of verified users.

#### `GET /ops/ledger`

- Response: array of ledger rows used by Agency dashboard.

#### `POST /ops/mediators/approve`

- Request: `{ "id": string }`

#### `POST /ops/users/approve`

- Request: `{ "id": string }`

#### `POST /ops/users/reject`

- Request: `{ "id": string }`

#### `POST /ops/orders/settle`

- Request: `{ "orderId": string }`

#### `POST /ops/verify`

- Request: `{ "orderId": string }`

#### `POST /ops/campaigns`

- Request: campaign creation payload as sent by UI.

#### `POST /ops/campaigns/assign`

- Request: `{ "id": string, "assignments": Record<string, any>, "dealType"?: string, "price"?: number, "payout"?: number }`

#### `POST /ops/deals/publish`

- Request: `{ "id": string, "commission": number, "mediatorCode": string }`

#### `POST /ops/payouts`

- Request: `{ "mediatorId": string, "amount": number }`

#### `POST /ops/invites/generate`

- Request: `{ "agencyId": string }`
- Response: `{ "code": string }` (UI extracts `.code`).

#### `POST /ops/invites/generate-buyer`

- Request: `{ "mediatorId": string }`
- Response: `{ "code": string }` (UI extracts `.code`).

### Brand (`/brand/*`)

All brand endpoints require auth and one of roles: `brand | ops | admin`.

#### `GET /brand/agencies?brandId=...`

- Response: array of connected agencies for the brand.

#### `GET /brand/campaigns?brandId=...`

- Response: array of `Campaign`.

#### `GET /brand/orders?brandName=...`

- Response: array of `Order`.

#### `GET /brand/transactions?brandId=...`

- Response: array of ledger rows shaped for UI export:
  - `{ id: string, date: string, agencyName: string, amount: number, ref: string, status: string }`

#### `POST /brand/payout`

- Records a payout from brand wallet to agency wallet, idempotent by `ref`.
- Request: `{ "brandId"?: string, "agencyId": string, "amount": number, "ref": string }`
- Response: implementation-defined JSON (UI treats non-2xx as failure).

#### `POST /brand/requests/resolve`

- Request: `{ "agencyCode": string, "action": "approve"|"reject" }`
- Response: implementation-defined JSON.

#### `POST /brand/agencies/remove`

- Request: `{ "brandId": string, "agencyCode": string }`

#### `POST /brand/campaigns`

- Request: campaign creation payload as sent by UI.

#### `PATCH /brand/campaigns/:campaignId`

- Request: campaign update payload as sent by UI.

### Orders (`/orders/*`)

All endpoints require auth.

#### `GET /orders/user/:userId`

- Response: `Order[]`.

#### `POST /orders`

- Buyer-only.
- Request: `{ userId: string, items: Array<...>, ...metadata }`
- Response (201): `Order`.
- Notes:
  - Optional: `preOrderId` may be provided to “upgrade” a redirect-tracked pre-order.
  - If proof is included at creation (`screenshots.order`, `screenshots.rating`, `reviewLink`), backend may auto-transition workflow to `UNDER_REVIEW`.

#### `POST /orders/claim`

- Buyer-only.
- Request: `{ orderId: string, type: string, data: string }`
- Response (200): `Order` (updated).
- Notes:
  - `type` is one of `order | rating | review`.
  - Backend enforces a strict workflow: only `ORDERED` or `UNDER_REVIEW` can accept proof.

### Products / Deals

#### `GET /products`

- Buyer-only.
- Response: `Deal[]` (UI calls these “products”).
- Notes:
  - UI may pass `?mediatorCode=...`, but backend scopes by authenticated buyer’s `parentCode`.

#### `POST /deals/:dealId/redirect`

- Buyer-only.
- Response (201): `{ preOrderId: string, url: string }`

### Tickets (`/tickets/*`)

All endpoints require auth.

#### `GET /tickets`

- Response: `Ticket[]`.

#### `POST /tickets`

- Request: `{ userId: string, userName: string, role: Role, orderId?: string, issueType: string, description: string }`

- Notes:
  - UI may send `userId/userName/role` from legacy forms; backend derives identity from auth context.

#### `PATCH /tickets/:id`

- Request: `{ status: TicketStatus }`

### Admin (`/admin/*`)

All admin endpoints require auth + role `admin`.

#### `GET /admin/users?role=...`

- Response (200): `User[]`.

#### `GET /admin/financials`

- Response (200): `Order[]`.

#### `GET /admin/stats`

- Response (200):
  - `{ totalRevenue: number, pendingRevenue: number, totalOrders: number, riskOrders: number, counts: { total:number, user:number, mediator:number, agency:number, brand:number } }`

#### `GET /admin/growth`

- Response (200): `{ date: string, revenue: number }[]` (last 7 days).

#### `GET /admin/products`

- Response (200): `Deal[]`.

#### `GET /admin/invites`

- Response (200): raw invite documents (sorted, limited).

#### `POST /admin/invites`

- Request: `{ role: string, label: string }`

- Response (201): `{ code: string, role: string, label: string, status: string, expiresAt: string|Date }`

#### `PATCH /admin/users/status`

- Request: `{ userId: string, status: string }`

- Response: `{ ok: true }`

### AI (`/ai/*`)

#### `POST /ai/chat`

- Request: `{ message: string, userId?: string, userName?: string, products?: any[], orders?: any[], tickets?: any[], image?: string }`
- Response: `{ text: string, intent: string, navigateTo?: "home"|"explore"|"orders"|"profile", uiType?: "product_card", data?: any[] }`

- Notes:
  - Currently does **not** require auth (UI may still send `Authorization`).

#### `POST /ai/verify-proof`

- Request: `{ imageBase64: string, expectedOrderId: string, expectedAmount: number }`
- Response: implementation-defined JSON with verification details.

- Notes:
  - Currently does **not** require auth.

#### `GET /ai/status`

- Response: `{ configured: boolean }`

#### `POST /ai/check-key`

- Auth + role `admin|ops`.
- Response: `{ ok: boolean, model: string, error?: string }`
