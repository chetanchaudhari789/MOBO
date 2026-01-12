# Push checklist

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
