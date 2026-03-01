import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { idWhere } from '../utils/idWhere.js';
import type { Role } from '../middleware/auth.js';
import { orderLog, businessLog } from '../config/logger.js';
import { logChangeEvent, logAccessEvent, logErrorEvent } from '../config/appLogs.js';
import { prisma } from '../database/prisma.js';
import { createTicketSchema, updateTicketSchema } from '../validations/tickets.js';
import { toUiTicket, toUiTicketForBrand } from '../utils/uiMappers.js';
import { pgTicket } from '../utils/pgMappers.js';
import { getRequester, isPrivileged } from '../services/authz.js';
import { getAgencyCodeForMediatorCode, listMediatorCodesForAgency } from '../services/lineage.js';
import { publishRealtime } from '../services/realtimeHub.js';
import { writeAuditLog } from '../services/audit.js';
import { parsePagination, paginatedResponse } from '../utils/pagination.js';

async function buildTicketAudience(ticket: any) {
  const privilegedRoles: Role[] = ['admin', 'ops'];
  const userIds = new Set<string>();
  const ticketOwnerMongoId = String(ticket?._id || ticket?.mongoId || '').trim();

  let mediatorCodes: string[] | undefined;
  let agencyCodes: string[] | undefined;

  const orderId = String(ticket?.orderId || '').trim();
  if (orderId) {
    const db = prisma();
    const order = await db.order.findFirst({
      where: { ...idWhere(orderId), deletedAt: null },
      select: {
        managerName: true,
        user: { select: { mongoId: true } },
        brandUser: { select: { mongoId: true } },
      },
    });
    if (order) {
      if (order.user?.mongoId) userIds.add(order.user.mongoId);
      if (order.brandUser?.mongoId) userIds.add(order.brandUser.mongoId);
      const mediatorCode = String(order.managerName || '').trim();
      if (mediatorCode) {
        mediatorCodes = [mediatorCode];
        const agencyCode = (await getAgencyCodeForMediatorCode(mediatorCode)) || '';
        if (agencyCode) agencyCodes = [agencyCode];
      }
    }
  }

  // Add ticket owner's mongoId for realtime targeting
  if (ticketOwnerMongoId) userIds.add(ticketOwnerMongoId);

  return { roles: privilegedRoles, userIds: Array.from(userIds), mediatorCodes, agencyCodes };
}

async function getScopedOrderMongoIds(params: {
  roles: string[];
  pgUserId: string;
  requesterUser: any;
}): Promise<string[]> {
  const { roles, pgUserId, requesterUser } = params;
  const db = prisma();

  if (isPrivileged(roles)) return [];

  if (roles.includes('brand')) {
    const orders = await db.order.findMany({
      where: { brandUserId: pgUserId, deletedAt: null },
      select: { mongoId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return orders.map((o) => o.mongoId!).filter(Boolean);
  }

  if (roles.includes('mediator')) {
    const mediatorCode = String(requesterUser?.mediatorCode || '').trim();
    if (!mediatorCode) return [];
    const orders = await db.order.findMany({
      where: { managerName: mediatorCode, deletedAt: null },
      select: { mongoId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return orders.map((o) => o.mongoId!).filter(Boolean);
  }

  if (roles.includes('agency')) {
    const agencyCode = String(requesterUser?.mediatorCode || '').trim();
    if (!agencyCode) return [];
    const mediatorCodes = await listMediatorCodesForAgency(agencyCode);
    if (!mediatorCodes.length) return [];
    const orders = await db.order.findMany({
      where: { managerName: { in: mediatorCodes }, deletedAt: null },
      select: { mongoId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return orders.map((o) => o.mongoId!).filter(Boolean);
  }

  return [];
}

async function assertCanReferenceOrder(params: { orderId: string; pgUserId: string; roles: string[]; user: any }) {
  const { orderId, pgUserId, roles, user } = params;
  const db = prisma();

  const order = await db.order.findFirst({
    where: { ...idWhere(orderId), deletedAt: null },
    select: { userId: true, managerName: true, brandUserId: true },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

  if (isPrivileged(roles)) return;

  if (roles.includes('shopper')) {
    if (order.userId !== pgUserId) throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your account');
    return;
  }
  if (roles.includes('brand')) {
    if ((order.brandUserId || '') !== pgUserId) throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your brand');
    return;
  }
  if (roles.includes('mediator')) {
    const mediatorCode = String(user?.mediatorCode || '').trim();
    if (!mediatorCode || order.managerName !== mediatorCode) throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your network');
    return;
  }
  if (roles.includes('agency')) {
    const agencyCode = String(user?.mediatorCode || '').trim();
    const mediatorCodes = agencyCode ? await listMediatorCodesForAgency(agencyCode) : [];
    if (!mediatorCodes.includes(order.managerName)) throw new AppError(403, 'FORBIDDEN', 'Cannot reference orders outside your network');
    return;
  }
  throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
}

export function makeTicketsController() {
  return {
    listTickets: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { roles, pgUserId, user } = getRequester(req);
        const db = prisma();

        const logTicketAccess = (count: number) => {
          logAccessEvent('RESOURCE_ACCESS', {
            userId: req.auth?.userId,
            roles: req.auth?.roles,
            ip: req.ip,
            resource: 'Ticket',
            requestId: String((res as any).locals?.requestId || ''),
            metadata: { action: 'TICKETS_LISTED', endpoint: 'listTickets', resultCount: count },
          });
        };

        if (isPrivileged(roles)) {
          const ticketWhere = { deletedAt: null };
          const { page, limit, skip, isPaginated } = parsePagination(req.query as any, { limit: 10000, maxLimit: 10000 });
          const [tickets, total] = await Promise.all([
            db.ticket.findMany({ where: ticketWhere, orderBy: { createdAt: 'desc' }, skip, take: limit }),
            db.ticket.count({ where: ticketWhere }),
          ]);
          res.json(paginatedResponse(tickets.map((t) => { try { return toUiTicket(pgTicket(t)); } catch (e) { orderLog.error(`[tickets] toUiTicket failed for ${t.id}`, { error: e }); return null; } }).filter(Boolean) as any[], total, page, limit, isPaginated));
          logTicketAccess(tickets.length);
          return;
        }

        if (roles.includes('shopper')) {
          const shopperWhere = { userId: pgUserId, deletedAt: null };
          const { page, limit, skip, isPaginated } = parsePagination(req.query as any);
          const [tickets, total] = await Promise.all([
            db.ticket.findMany({ where: shopperWhere, orderBy: { createdAt: 'desc' }, skip, take: limit }),
            db.ticket.count({ where: shopperWhere }),
          ]);
          res.json(paginatedResponse(tickets.map((t) => { try { return toUiTicket(pgTicket(t)); } catch (e) { orderLog.error(`[tickets] toUiTicket failed for ${t.id}`, { error: e }); return null; } }).filter(Boolean) as any[], total, page, limit, isPaginated));
          logTicketAccess(tickets.length);
          return;
        }

        const orderMongoIds = await getScopedOrderMongoIds({ roles, pgUserId, requesterUser: user });
        const ticketWhere = {
            deletedAt: null,
            OR: [{ userId: pgUserId }, ...(orderMongoIds.length ? [{ orderId: { in: orderMongoIds } }] : [])],
        };
        const { page, limit, skip, isPaginated } = parsePagination(req.query as any);
        const [tickets, total] = await Promise.all([
          db.ticket.findMany({
            where: ticketWhere,
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
          }),
          db.ticket.count({ where: ticketWhere }),
        ]);

        if (roles.includes('brand')) {
          res.json(paginatedResponse(tickets.map((t) => { try { return toUiTicketForBrand(pgTicket(t)); } catch (e) { orderLog.error(`[tickets] toUiTicketForBrand failed for ${t.id}`, { error: e }); return null; } }).filter(Boolean) as any[], total, page, limit, isPaginated));
          logTicketAccess(tickets.length);
          return;
        }
        res.json(paginatedResponse(tickets.map((t) => { try { return toUiTicket(pgTicket(t)); } catch (e) { orderLog.error(`[tickets] toUiTicket failed for ${t.id}`, { error: e }); return null; } }).filter(Boolean) as any[], total, page, limit, isPaginated));
        logTicketAccess(tickets.length);
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'DATABASE', severity: 'medium', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'tickets/listTickets' } });
        next(err);
      }
    },

    createTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = createTicketSchema.parse(req.body);
        const { roles, pgUserId, user } = getRequester(req);
        const userName = String(user?.name || 'User');
        const role = String(user?.role || roles[0] || 'shopper');
        const db = prisma();

        if (body.orderId) {
          await assertCanReferenceOrder({ orderId: body.orderId, pgUserId, roles, user });
        }

        const mongoId = randomUUID();
        const ticket = await db.ticket.create({
          data: {
            mongoId,
            userId: pgUserId,
            userName,
            role,
            orderId: body.orderId,
            issueType: body.issueType,
            description: body.description,
            status: 'Open' as any,
            createdBy: pgUserId,
          },
        });

        const mapped = pgTicket(ticket);
        const audience = await buildTicketAudience(mapped);
        publishRealtime({ type: 'tickets.changed', ts: new Date().toISOString(), payload: { ticketId: String(mapped._id) }, audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        await writeAuditLog({ req, action: 'TICKET_CREATED', entityType: 'Ticket', entityId: String(mapped._id), metadata: { issueType: body.issueType, orderId: body.orderId, actorRole: role } });
        businessLog.info('Ticket created', { ticketId: String(mapped._id), issueType: body.issueType, orderId: body.orderId, role });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Ticket', entityId: String(mapped._id), action: 'TICKET_CREATED', changedFields: ['status', 'issueType'], before: {}, after: { status: 'Open', issueType: body.issueType } });
        logAccessEvent('RESOURCE_ACCESS', { userId: req.auth?.userId, roles: req.auth?.roles, ip: req.ip, resource: 'Ticket', requestId: String((res as any).locals?.requestId || ''), metadata: { action: 'TICKET_CREATED', ticketId: String(mapped._id), issueType: body.issueType, orderId: body.orderId, role } });

        res.status(201).json(toUiTicket(mapped));
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'BUSINESS_LOGIC', severity: 'medium', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'createTicket' } });
        next(err);
      }
    },

    updateTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id || '');
        if (!id) throw new AppError(400, 'INVALID_TICKET_ID', 'Invalid ticket id');

        const body = updateTicketSchema.parse(req.body);
        const { roles, pgUserId, user } = getRequester(req);
        const db = prisma();

        const existing = await db.ticket.findFirst({ where: { ...idWhere(id), deletedAt: null } });
        if (!existing) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        if (!isPrivileged(roles) && existing.userId !== pgUserId) {
          if (existing.orderId) {
            await assertCanReferenceOrder({ orderId: existing.orderId, pgUserId, roles, user });
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Not allowed');
          }
        }

        const previousStatus = String(existing.status || '');
        const updatePayload: any = { status: body.status, updatedBy: pgUserId };
        if ((body.status === 'Resolved' || body.status === 'Rejected') && previousStatus === 'Open') {
          updatePayload.resolvedBy = pgUserId;
          updatePayload.resolvedAt = new Date();
          if ((body as any).resolutionNote) updatePayload.resolutionNote = String((body as any).resolutionNote).slice(0, 1000);
        }

        const ticket = await db.ticket.update({ where: { id: existing.id }, data: updatePayload });
        const mapped = pgTicket(ticket);

        const audience = await buildTicketAudience(mapped);
        publishRealtime({ type: 'tickets.changed', ts: new Date().toISOString(), payload: { ticketId: String(mapped._id), status: body.status }, audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        const auditAction = body.status === 'Resolved' ? 'TICKET_RESOLVED'
          : body.status === 'Rejected' ? 'TICKET_REJECTED'
          : (previousStatus === 'Resolved' || previousStatus === 'Rejected') && body.status === 'Open' ? 'TICKET_REOPENED'
          : 'TICKET_UPDATED';
        await writeAuditLog({ req, action: auditAction, entityType: 'Ticket', entityId: id, metadata: { previousStatus, newStatus: body.status, actorRole: String(user?.role || roles[0] || '') } });
        businessLog.info(`Ticket ${auditAction.toLowerCase().replace('ticket_', '')}`, { ticketId: id, previousStatus, newStatus: body.status });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Ticket', entityId: id, action: 'TICKET_STATUS_CHANGE', changedFields: ['status'], before: { status: previousStatus }, after: { status: body.status } });
        logAccessEvent('RESOURCE_ACCESS', { userId: req.auth?.userId, roles: req.auth?.roles, ip: req.ip, resource: 'Ticket', requestId: String((res as any).locals?.requestId || ''), metadata: { action: auditAction, ticketId: id, previousStatus, newStatus: body.status } });

        res.json(toUiTicket(mapped));
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'BUSINESS_LOGIC', severity: 'medium', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'updateTicket' } });
        next(err);
      }
    },

    deleteTicket: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = String(req.params.id || '').trim();
        if (!id) throw new AppError(400, 'INVALID_TICKET_ID', 'Invalid ticket id');

        const { roles, pgUserId, user } = getRequester(req);
        const db = prisma();

        const existing = await db.ticket.findFirst({ where: { ...idWhere(id), deletedAt: null } });
        if (!existing) throw new AppError(404, 'TICKET_NOT_FOUND', 'Ticket not found');

        if (String(existing.status || '').trim() === 'Open') {
          throw new AppError(409, 'TICKET_NOT_CLOSED', 'Ticket must be resolved or rejected before deletion');
        }

        if (!isPrivileged(roles) && existing.userId !== pgUserId) {
          if (existing.orderId) {
            await assertCanReferenceOrder({ orderId: existing.orderId, pgUserId, roles, user });
          } else {
            throw new AppError(403, 'FORBIDDEN', 'Not allowed');
          }
        }

        await db.ticket.update({ where: { id: existing.id }, data: { deletedAt: new Date(), deletedBy: pgUserId } });

        const mapped = pgTicket(existing);
        const audience = await buildTicketAudience(mapped);
        publishRealtime({ type: 'tickets.changed', ts: new Date().toISOString(), payload: { ticketId: String(mapped._id), deleted: true }, audience });
        publishRealtime({ type: 'notifications.changed', ts: new Date().toISOString(), audience });

        await writeAuditLog({ req, action: 'TICKET_DELETED', entityType: 'Ticket', entityId: id, metadata: { status: String(existing.status) } });
        businessLog.info('Ticket deleted', { ticketId: id, status: String(existing.status) });
        logChangeEvent({ actorUserId: req.auth?.userId, entityType: 'Ticket', entityId: id, action: 'TICKET_DELETED', changedFields: ['deletedAt'], before: { status: String(existing.status) }, after: { deleted: true } });
        logAccessEvent('RESOURCE_ACCESS', { userId: req.auth?.userId, roles: req.auth?.roles, ip: req.ip, resource: 'Ticket', requestId: String((res as any).locals?.requestId || ''), metadata: { action: 'TICKET_DELETED', ticketId: id, status: String(existing.status) } });

        res.json({ ok: true });
      } catch (err) {
        logErrorEvent({ error: err instanceof Error ? err : new Error(String(err)), message: err instanceof Error ? err.message : String(err), category: 'BUSINESS_LOGIC', severity: 'medium', userId: req.auth?.userId, requestId: String((res as any).locals?.requestId || ''), metadata: { handler: 'deleteTicket' } });
        next(err);
      }
    },
  };
}
