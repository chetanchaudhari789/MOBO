These tests are intentionally lightweight smoke tests for the backend.

- `health.spec.ts`: validates the `/api/health` endpoint responds.
- `mongoPlaceholder.spec.ts`: ensures placeholder Mongo URIs (including `REPLACE_ME`) fall back to in-memory Mongo in non-production.
