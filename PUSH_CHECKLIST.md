# Push checklist

## Branch rules

| Branch    | Who pushes                | Deploys to                   |
| --------- | ------------------------- | ---------------------------- |
| `main`    | Merge from `develop` only | Production (Render + Vercel) |
| `develop` | Direct push OK            | Staging (Render + Vercel)    |

**Never push directly to `main`.** Always merge from `develop` via PR.

## Before pushing to `develop` (or opening a PR to `main`)

Before pushing (or opening a PR), run these from the repo root:

1. Install deps (clean)

```bash
npm ci
```

2. Lint

```bash
npm run lint
```

3. Backend tests

```bash
npm run test:backend
```

4. E2E tests (Playwright)

```bash
npm run test:e2e
```

5. Verify hygiene

- No `node_modules/`, `.next/`, `dist/`, `coverage/`, `test-results/` committed (they’re ignored by `.gitignore`).
- No real secrets committed (`.env*` should be local-only; keep examples like `.env.example`).

## Merging `develop` → `main` (production release)

1. Ensure all checks above pass on `develop`
2. Open a Pull Request: `develop` → `main`
3. Review changes carefully (this goes to real users!)
4. Merge the PR (squash merge recommended)
5. Verify production health: `GET https://<render-backend>/api/health`
6. Quick smoke test on one portal (e.g. admin login)
