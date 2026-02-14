import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../middleware/errors.js';
import type { Env } from '../config/env.js';
import { OrderModel, type OrderWorkflowStatus } from '../models/Order.js';
import { pushOrderEvent } from './orderEvents.js';
import { notifyOrderWorkflowPush } from './pushNotifications.js';
import { writeAuditLog } from './audit.js';

const TERMINAL: ReadonlySet<OrderWorkflowStatus> = new Set(['COMPLETED', 'FAILED']);

const ALLOWED: Record<OrderWorkflowStatus, OrderWorkflowStatus[]> = {
  CREATED: ['REDIRECTED'],
  REDIRECTED: ['ORDERED'],
  ORDERED: ['PROOF_SUBMITTED'],
  PROOF_SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'PROOF_SUBMITTED'], // re-proof request
  APPROVED: ['REWARD_PENDING'],
  REJECTED: ['FAILED'],
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
  session?: ClientSession;
  env?: Env;
}) {
  assertTransition(params.from, params.to);

  const update: any = {
    $set: {
      workflowStatus: params.to,
    },
  };

  update.$set.updatedBy = params.actorUserId ? new mongoose.Types.ObjectId(params.actorUserId) : undefined;

  update.$setOnInsert = undefined;

  update.$push = {
    events: {
      $each: pushOrderEvent([], {
        type: 'WORKFLOW_TRANSITION',
        at: new Date(),
        actorUserId: params.actorUserId,
        metadata: {
          from: params.from,
          to: params.to,
          ...(params.metadata ?? {}),
        },
      }),
    },
  };

  const order = await OrderModel.findOneAndUpdate(
    {
      _id: params.orderId,
      deletedAt: null,
      frozen: { $ne: true },
      workflowStatus: params.from,
    } as any,
    update,
    { new: true, session: params.session }
  );

  if (!order) {
    const existing = await OrderModel.findById(params.orderId).select({ workflowStatus: 1, frozen: 1, deletedAt: 1 }).lean();
    if (!existing || (existing as any).deletedAt) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    if ((existing as any).frozen) {
      throw new AppError(409, 'ORDER_FROZEN', 'Order is frozen and requires explicit reactivation');
    }
    throw new AppError(409, 'ORDER_STATE_MISMATCH', 'Order state mismatch');
  }

  if (params.env) {
    notifyOrderWorkflowPush({
      env: params.env,
      order,
      from: params.from,
      to: params.to,
    }).catch(() => undefined);
  }

  await writeAuditLog({
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
  session?: ClientSession;
}) {
  const now = new Date();
  const res = await OrderModel.updateMany(
    {
      ...params.query,
      deletedAt: null,
      frozen: { $ne: true },
      workflowStatus: { $nin: Array.from(TERMINAL) },
    },
    {
      $set: {
        frozen: true,
        frozenAt: now,
        frozenReason: params.reason,
      },
      $push: {
        events: {
          type: 'WORKFLOW_FROZEN',
          at: now,
          actorUserId: params.actorUserId as any,
          metadata: { reason: params.reason },
        },
      },
    },
    { session: params.session }
  );

  await writeAuditLog({
    action: 'ORDERS_FROZEN',
    entityType: 'Order',
    entityId: 'bulk',
    metadata: { reason: params.reason, actorUserId: params.actorUserId, matchedCount: res.matchedCount, modifiedCount: res.modifiedCount },
  });

  return res;
}

export async function reactivateOrder(params: { orderId: string; actorUserId: string; reason?: string }) {
  const now = new Date();

  const order = await OrderModel.findOneAndUpdate(
    {
      _id: params.orderId,
      deletedAt: null,
      frozen: true,
      workflowStatus: { $nin: Array.from(TERMINAL) },
    } as any,
    {
      $set: {
        frozen: false,
        reactivatedAt: now,
        reactivatedBy: params.actorUserId as any,
      },
      $push: {
        events: {
          type: 'WORKFLOW_REACTIVATED',
          at: now,
          actorUserId: params.actorUserId as any,
          metadata: { reason: params.reason },
        },
      },
    },
    { new: true }
  );

  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found or not frozen');

  await writeAuditLog({
    action: 'ORDER_REACTIVATED',
    entityType: 'Order',
    entityId: params.orderId,
    metadata: { actorUserId: params.actorUserId, reason: params.reason },
  });

  return order;
}
