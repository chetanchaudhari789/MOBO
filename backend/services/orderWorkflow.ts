import { prisma } from '../database/prisma.js';
import { AppError } from '../middleware/errors.js';
import type { Env } from '../config/env.js';
import type { OrderWorkflowStatus } from '../models/Order.js';
import { pushOrderEvent as _pushOrderEvent } from './orderEvents.js';
import { notifyOrderWorkflowPush } from './pushNotifications.js';
import { writeAuditLog } from './audit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TERMINAL: ReadonlySet<OrderWorkflowStatus> = new Set(['COMPLETED', 'FAILED']);

const ALLOWED: Record<OrderWorkflowStatus, OrderWorkflowStatus[]> = {
  CREATED: ['REDIRECTED'],
  REDIRECTED: ['ORDERED'],
  ORDERED: ['PROOF_SUBMITTED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'PROOF_SUBMITTED'], // re-proof request
  APPROVED: ['REWARD_PENDING'],
  REJECTED: ['FAILED', 'PROOF_SUBMITTED'], // allow re-proof submission after rejection
  REWARD_PENDING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export function assertTransition(from: OrderWorkflowStatus, to: OrderWorkflowStatus) {
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(409, 'ILLEGAL_ORDER_TRANSITION', `Illegal order transition: ${from} -> ${to}`);
  }
}

export async function transitionOrderWorkflow(params: {
  orderId: string;
  from: OrderWorkflowStatus;
  to: OrderWorkflowStatus;
  actorUserId?: string;
  metadata?: any;
  tx?: any;
  env?: Env;
}) {
  assertTransition(params.from, params.to);

  const client = params.tx ?? prisma();

  // Read current order (need events array for append)
  const orderWhere = UUID_RE.test(params.orderId)
    ? { OR: [{ id: params.orderId }, { mongoId: params.orderId }], deletedAt: null }
    : { mongoId: params.orderId, deletedAt: null };
  const current = await client.order.findFirst({
    where: orderWhere as any,
    select: { id: true, mongoId: true, events: true, frozen: true, workflowStatus: true },
  });

  if (!current || current.deletedAt) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (current.frozen) {
    throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
  }
  if (current.workflowStatus !== params.from) {
    throw new AppError(409, 'ORDER_STATE_MISMATCH', 'Order state mismatch');
  }

  const currentEvents = Array.isArray(current.events) ? (current.events as any[]) : [];
  const newEvent = {
    type: 'WORKFLOW_TRANSITION',
    at: new Date().toISOString(),
    actorUserId: params.actorUserId,
    metadata: {
      from: params.from,
      to: params.to,
      ...(params.metadata ?? {}),
    },
  };

  // Atomic conditional update — if another request changed workflowStatus, count=0
  const updatedByVal = params.actorUserId && UUID_RE.test(params.actorUserId) ? params.actorUserId : undefined;
  const updated = await client.order.updateMany({
    where: {
      id: current.id,
      workflowStatus: params.from as any,
      frozen: false,
      deletedAt: null,
    },
    data: {
      workflowStatus: params.to as any,
      ...(updatedByVal ? { updatedBy: updatedByVal } : {}),
      events: [...currentEvents, newEvent] as any,
    },
  });

  if (updated.count === 0) {
    throw new AppError(409, 'ORDER_STATE_MISMATCH', 'Order state changed concurrently');
  }

  // Re-read full order to return
  const order = await client.order.findUnique({ where: { id: current.id }, include: { items: true } });

  if (params.env && order) {
    notifyOrderWorkflowPush({
      env: params.env,
      order: { ...order, _id: order.mongoId } as any,
      from: params.from,
      to: params.to,
    }).catch((err) => console.warn('[orderWorkflow] push notification failed:', err?.message || err));
  }

  writeAuditLog({
    action: 'ORDER_WORKFLOW_TRANSITION',
    entityType: 'Order',
    entityId: params.orderId,
    metadata: { from: params.from, to: params.to, actorUserId: params.actorUserId },
  });

  return order;
}

export async function freezeOrders(params: {
  query: any;
  reason: string;
  actorUserId?: string;
  tx?: any;
}) {
  const client = params.tx ?? prisma();
  const now = new Date();

  const freezeWhere = {
    ...params.query,
    deletedAt: null,
    frozen: false,
    workflowStatus: { notIn: Array.from(TERMINAL) as any },
  };

  // Collect the IDs and current events before updating so we can append atomically
  const ordersToFreeze = await client.order.findMany({
    where: freezeWhere,
    select: { id: true },
  });

  if (ordersToFreeze.length === 0) {
    return { count: 0 };
  }

  const newEventJson = JSON.stringify({
    type: 'WORKFLOW_FROZEN',
    at: now.toISOString(),
    actorUserId: params.actorUserId,
    metadata: { reason: params.reason },
  });

  const ids: string[] = ordersToFreeze.map((o: { id: string }) => o.id);

  // Atomically freeze and append WORKFLOW_FROZEN event in one SQL statement
  const affected = await client.$executeRaw`
    UPDATE orders
    SET
      frozen = true,
      "frozenAt" = ${now},
      "frozenReason" = ${params.reason},
      events = COALESCE(events, '[]'::jsonb) || ${newEventJson}::jsonb
    WHERE id = ANY(${ids}::uuid[])
  `;

  writeAuditLog({
    action: 'ORDERS_FROZEN',
    entityType: 'Order',
    entityId: 'bulk',
    metadata: { reason: params.reason, actorUserId: params.actorUserId, matchedCount: affected, modifiedCount: affected },
  });

  return { count: affected };
}

export async function reactivateOrder(params: { orderId: string; actorUserId: string; reason?: string; tx?: any }) {
  const client = params.tx ?? prisma();
  const now = new Date();

  // Read current order to append event
  const current = await client.order.findFirst({
    where: {
      mongoId: params.orderId,
      deletedAt: null,
      frozen: true,
      workflowStatus: { notIn: Array.from(TERMINAL) as any },
    },
    select: { id: true, events: true },
  });

  if (!current) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found or not frozen');

  const currentEvents = Array.isArray(current.events) ? (current.events as any[]) : [];
  const newEvent = {
    type: 'WORKFLOW_REACTIVATED',
    at: now.toISOString(),
    actorUserId: params.actorUserId,
    metadata: { reason: params.reason },
  };

  const order = await client.order.update({
    where: { id: current.id },
    data: {
      frozen: false,
      reactivatedAt: now,
      reactivatedBy: params.actorUserId,
      frozenReason: null,
      frozenAt: null,
      events: [...currentEvents, newEvent] as any,
    },
  });

  writeAuditLog({
    action: 'ORDER_REACTIVATED',
    entityType: 'Order',
    entityId: params.orderId,
    metadata: { actorUserId: params.actorUserId, reason: params.reason },
  });

  return order;
}
