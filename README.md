# MOBO Ecosystem Pro

Monorepo for the MOBO multi-portal product:

- **Backend API** (Express + TypeScript + MongoDB)
- **Buyer portal** (Next.js)
- **Mediator portal** (Next.js)
- **Agency portal** (Next.js)
- **Brand portal** (Next.js)
- **Admin portal** (Next.js)
- **E2E tests** (Playwright) + backend tests (Vitest)

All portals talk to the backend through a simple convention:

- Frontends call **`/api/*`**
- Each Next app rewrites `/api/*` → `${NEXT_PUBLIC_API_PROXY_TARGET}/api/*` (defaults to `http://localhost:8080`)

## Docs

- Architecture: `docs/ARCHITECTURE.md`
- API (UI contract): `docs/API.md`
- Deployment (quick): `docs/DEPLOYMENT.md` (see also `DEPLOYMENTS.md`)

## Repo layout

- `backend/` — Express API, Mongo models, services, seeds, tests
- `apps/buyer-app/` — Buyer Next.js app (port **3001**)
- `apps/mediator-app/` — Mediator Next.js app (port **3002**)
- `apps/agency-web/` — Agency Next.js app (port **3003**)
- `apps/brand-web/` — Brand Next.js app (port **3004**)
- `apps/admin-web/` — Admin Next.js app (port **3005**)
- `shared/` — shared UI/types/utilities used by portals
- `e2e/` — Playwright tests
- `playwright.config.ts` — multi-project Playwright config (buyer/mediator/agency/brand/admin/api)

## Prerequisites

- Node.js **20+** (recommended)
- npm **9+**

## Environment variables

### Backend (`backend/.env`)

Start by copying the example:

- Copy `backend/.env.example` → `backend/.env`

Key variables used by the backend (see `backend/config/env.ts`):

- `NODE_ENV`: `development` | `test` | `production`
- `PORT`: default `8080`
- `MONGODB_URI`: required (in non-prod you can use a placeholder to force in-memory Mongo)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: in **production** must be real secrets (>= 20 chars)
- `CORS_ORIGINS`: comma-separated list of allowed origins
- `GEMINI_API_KEY`: optional; if blank, AI routes are effectively disabled

**Local dev tip:** the example uses `MONGODB_URI=<REPLACE_ME>` which triggers an **in-memory MongoDB** in non-production for easier local setup.

### Frontend (`NEXT_PUBLIC_API_PROXY_TARGET`)

Each Next app supports:

- `NEXT_PUBLIC_API_PROXY_TARGET` (optional)
  - Default: `http://localhost:8080`
  - Used by Next rewrites to proxy `/api/*` to the backend

You can set this in your shell, or in each app’s `.env.local` if you want.

## Install

From repo root:

```bash
npm install
```

## Run locally (recommended)

### Option A: start everything (backend + all portals)

```bash
npm run dev:all
```

Ports:

- Backend API: http://localhost:8080
- Buyer: http://localhost:3001
- Mediator: http://localhost:3002
- Agency: http://localhost:3003
- Brand: http://localhost:3004
- Admin: http://localhost:3005

### Option B: start individually

```bash
npm run dev:backend
npm run dev:buyer
npm run dev:mediator
npm run dev:agency
npm run dev:brand
npm run dev:admin
```

## Testing

### One command (recommended)

Runs backend tests + Playwright E2E:

```bash
npm test
```

### Backend tests only

```bash
npm run test:backend
```

### E2E tests only

```bash
npm run test:e2e
```

Notes:

- Playwright auto-starts a **safe E2E backend** (`backend` `dev:e2e`) and all portals.
- E2E runs use seeded accounts and an in-memory DB; they do not touch real databases.

## Common issues / troubleshooting

- **CORS errors**: ensure `CORS_ORIGINS` in `backend/.env` includes your portal origin(s).
- **Auth/secret errors in production**: `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be real secrets (>= 20 chars) in `NODE_ENV=production`.
- **API mismatch**: if your backend isn’t on `http://localhost:8080`, set `NEXT_PUBLIC_API_PROXY_TARGET`.

## Deployment

See **DEPLOYMENTS.md** for production deployment options, required environment variables, and recommended CI/CD flow.
