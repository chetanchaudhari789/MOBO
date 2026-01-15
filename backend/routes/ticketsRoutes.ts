import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { makeTicketsController } from '../controllers/ticketsController.js';

export function ticketsRoutes(env: Env): Router {
  const router = Router();
  const tickets = makeTicketsController();

  router.get('/tickets', requireAuth(env), tickets.listTickets);
  router.post('/tickets', requireAuth(env), tickets.createTicket);
  router.patch('/tickets/:id', requireAuth(env), tickets.updateTicket);
  router.delete('/tickets/:id', requireAuth(env), tickets.deleteTicket);

  return router;
}
