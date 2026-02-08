import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import type { Role } from '../middleware/auth.js';
import { TicketModel } from '../models/Ticket.js';
import { createTicketSchema, updateTicketSchema } from '../validations/tickets.js';
import { toUiTicket, toUiTicketForBrand } from '../utils/uiMappers.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { OrderModel } from '../models/Order.js';
import { getAgencyCodeForMediatorCode, listMediatorCodesForAgency } from '../services/lineage.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { writeAuditLog } from '../services/audit.js';

async function buildTicketAudience(ticket: any) {
  const privilegedRoles: Role[] = ['admin', 'ops'];

  const userIds = new Set<string>();
  const ticketOwnerUserId = String(ticket?.userId || '').trim();
  if (ticketOwnerUserId) userIds.add(ticketOwnerUserId);

  let mediatorCodes: string[] | undefined;
  let agencyCodes: string[] | undefined;

  const orderId = String(ticket?.orderId || '').trim();
  if (orderId) {
    const order = await OrderModel.findById(orderId)
      .select({ userId: 1, brandUserId: 1, managerName: 1, deletedAt: 1 })
      .lean();
    if (order && !(order as any).deletedAt) {
      const buyerUserId = String((order as any).userId || '').trim();
      const brandUserId = String((order as any).brandUserId || '').trim();
      if (buyerUserId) userIds.add(buyerUserId);
      if (brandUserId) userIds.add(brandUserId);

      const mediatorCode = String((order as any).managerName || '').trim();
      if (mediatorCode) {
        mediatorCodes = [mediatorCode];
        const agencyCode = (await getAgencyCodeForMediatorCode(mediatorCode)) || '';
        if (agencyCode) agencyCodes = [String(agencyCode).trim()];
      }
    }
  }

  return {
    roles: privilegedRoles,
    userIds: Array.from(userIds),
    mediatorCodes,
    agencyCodes,
  };
}

async function getScopedOrderIdsForRequester(params: {
  roles: string[];
  requesterId: string;
  requesterUser: any;
}): Promise<string[]> {
  const { roles, requesterId, requesterUser } = params;

  if (isPrivileged(roles)) return [];

  if (roles.includes('brand')) {
    const orders = await OrderModel.find({ brandUserId: requesterId, deletedAt: null })
      .select({ _id: 1 })
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    return orders.map((o) => String((o as any)._id));
  }

  if (roles.includes('mediator')) {
    const mediatorCode = String((requesterUser as any)?.mediatorCode || '').trim();
    if (!mediatorCode) return [];
    const orders = await OrderModel.find({ managerName: mediatorCode, deletedAt: null })
      .select({ _id: 1 })
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    return orders.map((o) => String((o as any)._id));
  }

  if (roles.includes('agency')) {
    const agencyCode = String((requesterUser as any)?.mediatorCode || '').trim();
    if (!agencyCode) return [];
    const mediatorCodes = await listMediatorCodesForAgency(agencyCode);
    if (!mediatorCodes.length) return [];
    const orders = await OrderModel.find({ managerName: { $in: mediatorCodes }, deletedAt: null })
      .select({ _id: 1 })
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean();
    return orders.map((o) => String((o as any)._id));
  }

  return [];
}

async function assertCanReferenceOrder(params: { orderId: string; requesterId: string; roles: string[]; user: any }) {
  const { orderId, requesterId, roles, user } = params;

  const order = await OrderModel.findById(orderId).select({ userId: 1, managerName: 1, brandUserId: 1, deletedAt: 1 }).lean();
  if (!order || (order as any).deletedAt) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

  if (isPrivileged(roles)) return;

  if (roles.includes('shopper')) {
    if (String((order as any).userId) !== String(requesterId)) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your account');
    }
    return;
  }

  if (roles.includes('brand')) {
    if (String((order as any).brandUserId || '') !== String(requesterId)) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your brand');
    }
    return;
  }

  if (roles.includes('mediator')) {
    const mediatorCode = String((user as any)?.mediatorCode || '').trim();
    if (!mediatorCode || String((order as any).managerName || '') !== mediatorCode) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your network');
    }
    return;
  }

  if (roles.includes('agency')) {
    const agencyCode = String((user as any)?.mediatorCode || '').trim();
    const mediatorCodes = agencyCode ? await listMediatorCodesForAgency(agencyCode) : [];
    if (!mediatorCodes.includes(String((order as any).managerName || ''))) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your network');
    }
    return;
  }

  throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
}

export function makeTicketsController() {
  return {
    listTickets: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, userId, user } = getRequester(req);

        const baseQuery: any = { deletedAt: null };

        // Privileged can see all tickets.
        if (isPrivileged(roles)) {
          const tickets = await TicketModel.find(baseQuery).sort({ createdAt: -1 }).limit(5000).lean();
          res.json(tickets.map(toUiTicket));
          return;
        }

        // Buyers see only their own tickets.
        if (roles.includes('shopper')) {
          const tickets = await TicketModel.find({ ...baseQuery, userId }).sort({ createdAt: -1 }).limit(2000).lean();
          res.json(tickets.map(toUiTicket));
          return;
        }

        // Partner/brand support: tickets on orders within their scope OR their own tickets.
        const orderIds = await getScopedOrderIdsForRequester({ roles, requesterId: userId, requesterUser: user });
        const tickets = await TicketModel.find({
          ...baseQuery,
          $or: [{ userId }, ...(orderIds.length ? [{ orderId: { $in: orderIds } }] : [])],
        })
          .sort({ createdAt: -1 })
          .limit(5000)
          .lean();

        if (roles.includes('brand')) {
          res.json(tickets.map(toUiTicketForBrand));
          return;
        }
        res.json(tickets.map(toUiTicket));
      } catch (err) {
        next(err);
      }
    },

    createTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createTicketSchema.parse(req.body);

        const { roles, userId, user } = getRequester(req);
        const userName = String((user as any)?.name || 'User');
        const role = String((user as any)?.role || roles[0] || 'shopper');

        if (body.orderId) {
          await assertCanReferenceOrder({ orderId: body.orderId, requesterId: userId, roles, user });
        }

        const ticket = await TicketModel.create({
          userId,
          userName,
          role,
          orderId: body.orderId,
          issueType: body.issueType,
          description: body.description,
          status: 'Open',
          createdBy: userId as any,
        });

        const audience = await buildTicketAudience(ticket);
        publishRealtime({
          type: 'tickets.changed',
          ts: new Date().toISOString(),
          payload: { ticketId: String((ticket as any)._id) },
          audience,
        });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        await writeAuditLog({
          req,
          action: 'TICKET_CREATED',
          entityType: 'Ticket',
          entityId: String((ticket as any)._id),
          metadata: { issueType: body.issueType, orderId: body.orderId },
        });

        res.status(201).json(toUiTicket(ticket.toObject()));
      } catch (err) {
        next(err);
      }
    },

    updateTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id || '');
        if (!id) throw new AppError(400, 'INVALID_TICKET_ID', 'Invalid ticket id');

        const body = updateTicketSchema.parse(req.body);

        const { roles, userId, user } = getRequester(req);

        const existing = await TicketModel.findById(id).lean();
        if (!existing || (existing as any).deletedAt) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        // Owners can update their own tickets; privileged can update any; otherwise require order-scope.
        if (!isPrivileged(roles) && String((existing as any).userId) !== String(userId)) {
          if ((existing as any).orderId) {
            await assertCanReferenceOrder({ orderId: String((existing as any).orderId), requesterId: userId, roles, user });
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Not allowed');
          }
        }

        const previousStatus = String((existing as any).status || '');

        // Track resolution metadata when status transitions to Resolved or Rejected.
        const updatePayload: any = { status: body.status, updatedBy: userId as any };
        if ((body.status === 'Resolved' || body.status === 'Rejected') && previousStatus === 'Open') {
          updatePayload.resolvedBy = userId;
          updatePayload.resolvedAt = new Date();
          if ((body as any).resolutionNote) {
            updatePayload.resolutionNote = String((body as any).resolutionNote).slice(0, 1000);
          }
        }

        const ticket = await TicketModel.findByIdAndUpdate(id, updatePayload, { new: true });
        if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        const audience = await buildTicketAudience(ticket);
        publishRealtime({
          type: 'tickets.changed',
          ts: new Date().toISOString(),
          payload: { ticketId: String((ticket as any)._id), status: body.status },
          audience,
        });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        const auditAction = body.status === 'Resolved' ? 'TICKET_RESOLVED'
          : body.status === 'Rejected' ? 'TICKET_REJECTED'
          : 'TICKET_UPDATED';
        await writeAuditLog({
          req,
          action: auditAction,
          entityType: 'Ticket',
          entityId: id,
          metadata: { previousStatus, newStatus: body.status },
        });

        res.json(toUiTicket(ticket.toObject()));
      } catch (err) {
        next(err);
      }
    },

    deleteTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) throw new AppError(400, 'INVALID_TICKET_ID', 'Invalid ticket id');

        const { roles, userId, user } = getRequester(req);

        const existing = await TicketModel.findById(id).lean();
        if (!existing || (existing as any).deletedAt) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        const status = String((existing as any).status || '').trim();
        if (status === 'Open') {
          throw new AppError(409, 'TICKET_NOT_CLOSED', 'Ticket must be resolved or rejected before deletion');
        }

        // Owners can delete their own tickets; privileged can delete any; otherwise require order-scope.
        if (!isPrivileged(roles) && String((existing as any).userId) !== String(userId)) {
          if ((existing as any).orderId) {
            await assertCanReferenceOrder({ orderId: String((existing as any).orderId), requesterId: userId, roles, user });
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Not allowed');
          }
        }

        const ticket = await TicketModel.findByIdAndUpdate(
          id,
          { deletedAt: new Date(), deletedBy: userId as any },
          { new: true }
        );
        if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        const audience = await buildTicketAudience(ticket);
        publishRealtime({
          type: 'tickets.changed',
          ts: new Date().toISOString(),
          payload: { ticketId: String((ticket as any)._id), deleted: true },
          audience,
        });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        await writeAuditLog({
          req,
          action: 'TICKET_DELETED',
          entityType: 'Ticket',
          entityId: id,
          metadata: { status: String((existing as any).status) },
        });

        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  };
}
