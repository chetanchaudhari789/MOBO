# Deployments

This repo is a monorepo containing:

- A Node/Express backend API (`backend/`)
- Five Next.js apps (`apps/*`)
- Shared packages (`shared/`)

All portals call the backend via `/api/*` and each Next app rewrites `/api/*` to:

- `${NEXT_PUBLIC_API_PROXY_TARGET}/api/*` (default `http://localhost:8080`)

## Production architecture (recommended)

- **MongoDB**: MongoDB Atlas (or managed Mongo on your cloud)
- **Backend**: Node process (container or VM) exposed over HTTPS
- **Frontends**: deploy each Next app independently (e.g., Vercel, Netlify, or Node server)

Key production requirement:

- Every deployed frontend must set `NEXT_PUBLIC_API_PROXY_TARGET` to your backend base URL.

## Backend deployment

### Build and start

From repo root:

```bash
npm install
npm --prefix backend run build
npm --prefix backend run start
```

The backend listens on `PORT` (default `8080`).

### Required environment variables (backend)

Create environment variables for your backend runtime (container/env config). The backend reads these (see `backend/config/env.ts`):

- `NODE_ENV=production`
- `PORT=8080` (or your provider port)
- `MONGODB_URI=<your real MongoDB connection string>`
- `MONGODB_DBNAME=<optional>`
- `JWT_ACCESS_SECRET=<strong random secret, >= 20 chars>`
- `JWT_REFRESH_SECRET=<strong random secret, >= 20 chars>`
- `JWT_ACCESS_TTL_SECONDS=900` (optional)
- `JWT_REFRESH_TTL_SECONDS=2592000` (optional)
- `CORS_ORIGINS=<comma-separated list of allowed origins>`
- `GEMINI_API_KEY=<optional>`

Notes:

- In production, placeholder values like `<REPLACE_ME>` are rejected for `MONGODB_URI` and JWT secrets.
- If `GEMINI_API_KEY` is empty, AI routes may not work (depending on route behavior).

### CORS configuration

Set `CORS_ORIGINS` to include your deployed portals’ origins, for example:

- `https://buyer.example.com`
- `https://mediator.example.com`
- `https://agency.example.com`
- `https://brand.example.com`
- `https://admin.example.com`

Use a comma-separated string.

### Health check

The backend exposes a health endpoint used by E2E and suitable for prod health checks:

- `GET /api/health`

Configure your hosting provider to check this URL.

## Frontend (Next.js) deployment

Each portal is a separate Next app:

- `apps/buyer-app` (port 3001 in dev)
- `apps/mediator-app` (port 3002 in dev)
- `apps/agency-web` (port 3003 in dev)
- `apps/brand-web` (port 3004 in dev)
- `apps/admin-web` (port 3005 in dev)

### Required environment variables (frontends)

All portals should set:

- `NEXT_PUBLIC_API_PROXY_TARGET=https://api.example.com`

This is used by Next rewrites so the UI can call `/api/*` and get routed to the backend.

### Build and start (Node-hosted)

Example for buyer app:

```bash
npm install
npm --prefix apps/buyer-app run build
npm --prefix apps/buyer-app run start
```

Repeat for each portal.

### Deploying to Vercel (common setup)

For each portal:

- Create a separate Vercel project pointing at the portal directory (e.g., `apps/buyer-app`)
- Set **Environment Variables**:
  - `NEXT_PUBLIC_API_PROXY_TARGET` → your backend URL
- Build command: `npm run build`
- Output: Next.js default

If you use Vercel, ensure the backend allows CORS from your Vercel domains.

#### Vercel (step-by-step)

Do this once per portal (buyer/mediator/agency/brand/admin).

1. In Vercel, click **Add New → Project**.
2. Import your GitHub repo.
3. Set the **Root Directory** to the portal you’re deploying, e.g.:

- `apps/buyer-app`
- `apps/mediator-app`
- `apps/agency-web`
- `apps/brand-web`
- `apps/admin-web`

4. Framework preset: **Next.js**.
5. Environment variables (Project → Settings → Environment Variables):

- `NEXT_PUBLIC_API_PROXY_TARGET` = `https://<your-backend-host>`

6. Deploy.

Notes:

- Because this is a monorepo, Vercel will run installs at the repo level. That’s fine; each portal’s `build` script already uses the repo’s helper (`scripts/next.mjs`).
- If you use separate domains, remember to add those domains to backend `CORS_ORIGINS`.

## Render deployment (backend)

Render is a good fit for the Express backend. Recommended is a **Web Service**.

### Render (step-by-step)

1. Push the repo to GitHub (see README for local scripts).
2. In Render: **New → Web Service**.
3. Connect your GitHub repo.
4. Configuration:

- **Root Directory**: leave blank (repo root)
- **Runtime**: Node
- **Build Command**:
  - `npm install; npm --prefix backend run build`
- **Start Command**:
  - `npm --prefix backend run start`

5. Set environment variables in Render (**Environment** tab):

- `NODE_ENV=production`
- `PORT=8080` (Render will inject `PORT` automatically; you can omit setting it if Render provides it)
- `MONGODB_URI=...` (MongoDB Atlas connection string)
- `JWT_ACCESS_SECRET=...` (>= 20 chars)
- `JWT_REFRESH_SECRET=...` (>= 20 chars)
- `CORS_ORIGINS=https://<buyer>,https://<mediator>,https://<agency>,https://<brand>,https://<admin>`
- `GEMINI_API_KEY=...` (optional)

6. Deploy.

After deploy:

- Health check: open `https://<your-render-backend>/api/health`
- Use that backend base URL as `NEXT_PUBLIC_API_PROXY_TARGET` in each Vercel portal.

### Render notes

- Make sure your MongoDB IP access rules allow Render (Atlas typically: allow 0.0.0.0/0 or add Render egress IPs).
- In production, the backend rejects placeholder envs for `MONGODB_URI` and JWT secrets.

## CI/CD recommendations

A practical baseline pipeline:

1. `npm install`
2. `npm test` (runs backend vitest + Playwright E2E)
3. Build backend: `npm --prefix backend run build`
4. Build each portal: `npm --prefix apps/<portal> run build`
5. Deploy backend and portals

If your CI runners cannot run browsers, split E2E into a separate job or use Playwright’s official runner images.

## E2E runtime safety

Playwright E2E is configured to start a **safe** E2E backend using `npm --prefix backend run dev:e2e`.

- Uses an in-memory DB + deterministic seeding
- Should not require real `MONGODB_URI` or AI keys

Do not reuse the E2E mode for production.
