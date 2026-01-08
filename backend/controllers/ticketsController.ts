import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errors.js';
import { TicketModel } from '../models/Ticket.js';
import { createTicketSchema, updateTicketSchema } from '../validations/tickets.js';
import { toUiTicket } from '../utils/uiMappers.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { OrderModel } from '../models/Order.js';
import { listMediatorCodesForAgency } from '../services/lineage.js';

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

        const ticket = await TicketModel.findByIdAndUpdate(
          id,
          { status: body.status, updatedBy: userId as any },
          { new: true }
        );
        if (!ticket) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        res.json(toUiTicket(ticket.toObject()));
      } catch (err) {
        next(err);
      }
    },
  };
}
