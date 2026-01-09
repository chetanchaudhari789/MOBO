# Deployment

This doc complements [DEPLOYMENTS.md](../DEPLOYMENTS.md) with a minimal, copy/paste oriented setup.

If you do not have custom domains yet, use: `docs/DEPLOYMENT_RENDER_VERCEL_NO_DOMAIN.md`.

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
- `MONGODB_URI=...` (Atlas)
- `JWT_ACCESS_SECRET=...` (>= 20 chars)
- `JWT_REFRESH_SECRET=...` (>= 20 chars)
- `CORS_ORIGINS=https://<buyer>,https://<mediator>,https://<agency>,https://<brand>,https://<admin>`

Health check:

- `GET /api/health`

## Frontends (Vercel)

Deploy each portal as its own Vercel project with Root Directory set to:

- `apps/buyer-app`
- `apps/mediator-app`
- `apps/agency-web`
- `apps/brand-web`
- `apps/admin-web`

Each portal must set:

- `NEXT_PUBLIC_API_PROXY_TARGET=https://<your-backend-host>`

That keeps the UI contract stable (`/api/*` on the client, rewritten server-side to the backend).
