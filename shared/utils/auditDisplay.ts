/**
 * Audit Log display helpers — filter noisy entries, show human-readable labels,
 * and deduplicate consecutive identical actions.
 */

/** Actions we surface in the Activity Log. Everything else is hidden. */
const VISIBLE_ACTIONS = new Set([
  'ORDER_CREATED',
  'PROOF_SUBMITTED',
  'PROOF_UPLOADED',
  'ORDER_VERIFIED',
  'ORDER_SETTLED',
  'ORDER_REJECTED',
  'MISSING_PROOF_REQUESTED',
  'ORDER_UNSETTLED',
]);

/** Human-readable labels */
const ACTION_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Order Created',
  PROOF_SUBMITTED: 'Proof Submitted',
  PROOF_UPLOADED: 'Proof Uploaded',
  ORDER_VERIFIED: 'Verified',
  ORDER_SETTLED: 'Cashback Released',
  ORDER_REJECTED: 'Rejected',
  MISSING_PROOF_REQUESTED: 'Proof Requested',
  ORDER_UNSETTLED: 'Cashback Reversed',
};

/**
 * Filter audit logs to only meaningful entries and deduplicate consecutive
 * same-action rows (e.g. two ORDER_CREATED in a row → keep the first).
 */
export function filterAuditLogs(logs: any[]): any[] {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((log) => VISIBLE_ACTIONS.has(log.action))
    .filter((log, i, arr) => i === 0 || log.action !== arr[i - 1]?.action);
}

/** Get a clean, human-readable label for an audit action string. */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}
