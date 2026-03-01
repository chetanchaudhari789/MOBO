// ──────────────────────────────────────────────────────────
// Application lifecycle state — shared across modules.
// Avoids circular imports between index.ts and route files.
// ──────────────────────────────────────────────────────────

/** True once the server is listening AND the database is connected. */
export let isReady = false;

export function setReady(value: boolean) {
  isReady = value;
}

/** True once shutdown has been initiated. */
export let isShuttingDown = false;

export function setShuttingDown(value: boolean) {
  isShuttingDown = value;
}
