export type OrderEventType =
  | 'ORDERED'
  | 'PROOF_SUBMITTED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FRAUD_ALERT'
  | 'SETTLED'
  | 'UNSETTLED'
  | 'CAP_EXCEEDED'
  | 'FROZEN_DISPUTED'
  | 'MISSING_PROOF_REQUESTED'
  | 'STATUS_CHANGED'
  | 'WORKFLOW_TRANSITION'
  | 'WORKFLOW_FROZEN'
  | 'WORKFLOW_REACTIVATED';

export type OrderEvent = {
  type: OrderEventType;
  at: Date;
  actorUserId?: string;
  metadata?: any;
};

export function pushOrderEvent(events: any[] | undefined, event: OrderEvent) {
  const arr = Array.isArray(events) ? events : [];
  arr.push({
    type: event.type,
    at: event.at,
    actorUserId: event.actorUserId as any,
    metadata: event.metadata,
  });
  return arr;
}

export function isTerminalAffiliateStatus(status: string): boolean {
  return (
    status === 'Approved_Settled' ||
    status === 'Cap_Exceeded' ||
    status === 'Frozen_Disputed'
  );
}
