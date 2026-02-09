# Deployment

This doc is the minimal, copy/paste oriented setup.

If you do not have custom domains yet, use: `docs/DEPLOYMENT_RENDER_VERCEL_NO_DOMAIN.md`.

Before deploying, verify locally from repo root:

- Clean generated artifacts (optional): `npm run clean`
- Build everything: `npm run build`
- Run backend tests: `npm run test:backend`
- Run E2E tests: `npm run test:e2e`

---

## Branch Strategy

| Branch    | Purpose            | Backend (Render)                             | Database (Atlas) | Frontends (Vercel)            |
| --------- | ------------------ | -------------------------------------------- | ---------------- | ----------------------------- |
| `main`    | **Production**     | https://mobo-agig.onrender.com               | `mobo`           | Production deployments        |
| `develop` | **Staging / Test** | _(create a second Render Web Service below)_ | `mobo_staging`   | Preview / staging deployments |

**Workflow:**

1. All new features / changes go into `develop` first
2. Test on staging (separate Render service + separate database `mobo_staging`)
3. When confirmed stable, merge `develop` → `main` via Pull Request
4. Production auto-deploys from `main`

**Rules:**

- Never push directly to `main` — always merge from `develop`
- `main` is always stable and live for real users
- `develop` is for testing — breaking it is OK

---

## Live URLs

### Production

| Service  | URL                            | Branch |
| -------- | ------------------------------ | ------ |
| Backend  | https://mobo-agig.onrender.com | `main` |
| Buyer    | https://www.buzzma.in          | `main` |
| Mediator | https://www.mediatorbuzzma.in  | `main` |
| Agency   | https://www.agencybuzzma.in    | `main` |
| Brand    | https://www.brandbuzzma.in     | `main` |
| Admin    | https://moboadmin.vercel.app   | `main` |

### Database Naming

| Environment | `MONGODB_DBNAME` | Actual DB          |
| ----------- | ---------------- | ------------------ |
| Production  | `mobo`           | `mobo`             |
| Staging     | `mobo_staging`   | `mobo_staging`     |
| E2E tests   | (auto)           | `mobo_e2e`         |
| Local dev   | (auto)           | `mobo` (in-memory) |

---

## Backend (Render)

Recommended: Render **Web Service** running Node.

Note on Render **Root Directory**:

- If Root Directory is blank (repo root), the `--prefix backend` commands below are correct.
- If Root Directory is set to `backend`, remove `--prefix backend` (otherwise it becomes `backend/backend`).

- Build (repo root Root Directory): `npm install --include=dev; npm --prefix backend run build`
- Build (Root Directory = `backend`): `npm install --include=dev; npm run build`
- Start: `npm --prefix backend run start`

If you see `TS2688: Cannot find type definition file for 'node'` on Render, it means devDependencies (like `@types/node`) were not installed during build. Fix by using `--include=dev` as above or set `NPM_CONFIG_PRODUCTION=false` in Render.

Required env vars:

- `NODE_ENV=production`
- `MONGODB_URI=mongodb+srv://...@cluster0.qycj89f.mongodb.net/?appName=Cluster0` (Atlas)
- `MONGODB_DBNAME=mobo`
- `JWT_ACCESS_SECRET=...` (>= 20 chars)
- `JWT_REFRESH_SECRET=...` (>= 20 chars)
- `CORS_ORIGINS=https://www.buzzma.in,https://www.mediatorbuzzma.in,https://www.agencybuzzma.in,https://www.brandbuzzma.in,https://moboadmin.vercel.app`

Health check:

- `GET /api/health`
- Production: https://mobo-agig.onrender.com/api/health

### Staging Backend (Render — second Web Service)

Create a **second** Render Web Service for the `develop` branch:

1. Render → New Web Service → same GitHub repo → **Branch: `develop`**
2. Same build/start commands as production
3. Environment variables — same as production **except**:
   - `MONGODB_DBNAME=mobo_staging`
   - `CORS_ORIGINS=<staging portal origins>` (can use `.vercel.app` wildcard for previews)
   - Different `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`

## Admin login (production)

Admin/ops login is **username/password** (not mobile).

To ensure the admin exists in production, set these env vars on Render:

- `ADMIN_SEED_USERNAME`
- `ADMIN_SEED_PASSWORD`
- `ADMIN_SEED_MOBILE`
- `ADMIN_SEED_NAME`

Then either:

- Temporarily set `SEED_ADMIN=true` for one deploy (recommended), verify login, then remove it.
- Or run `npm -w @mobo/backend run seed:admin` manually against the production DB.

Note: in `NODE_ENV=production`, the seed refuses to run if the admin seed variables are missing/placeholder.

## Frontends (Vercel)

Deploy each portal as its own Vercel project with Root Directory set to:

- `apps/buyer-app`
- `apps/mediator-app`
- `apps/agency-web`
- `apps/brand-web`
- `apps/admin-web`

Each portal must set:

- `NEXT_PUBLIC_API_PROXY_TARGET=https://mobo-agig.onrender.com`

Current production portal URLs:

| Portal   | Vercel URL                    |
| -------- | ----------------------------- |
| Buyer    | https://www.buzzma.in         |
| Mediator | https://www.mediatorbuzzma.in |
| Agency   | https://www.agencybuzzma.in   |
| Brand    | https://www.brandbuzzma.in    |
| Admin    | https://moboadmin.vercel.app  |

That keeps the UI contract stable (`/api/*` on the client, rewritten server-side to the backend).
