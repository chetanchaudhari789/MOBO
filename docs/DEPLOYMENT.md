# Deployment

This doc complements [DEPLOYMENTS.md](../DEPLOYMENTS.md) with a minimal, copy/paste oriented setup.

If you do not have custom domains yet, use: `docs/DEPLOYMENT_RENDER_VERCEL_NO_DOMAIN.md`.

## Backend (Render)

Recommended: Render **Web Service** running Node.

- Build: `npm install; npm --prefix backend run build`
- Start: `npm --prefix backend run start`

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
