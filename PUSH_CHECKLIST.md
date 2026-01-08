# Push checklist

Before pushing to GitHub:

- Confirm no secrets are committed
  - `.env` files are ignored by git; only `*.example` should be tracked.
  - Search for accidental secrets in tracked files (JWT/Gemini/Mongo URIs).
- Confirm installs/tests are green
  - `npm ci`
  - `npm run test:backend`
  - `npm test` (includes Playwright E2E)
- Confirm deploy-time env vars are set in your hosts
  - Backend: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, optionally `GEMINI_API_KEY`
  - Portals: `NEXT_PUBLIC_API_PROXY_TARGET`

Suggested first release tags:

- `v0.1.0` once deployed to staging
- `v1.0.0` once production verified
