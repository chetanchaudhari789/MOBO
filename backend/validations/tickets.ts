import { z } from 'zod';

// NOTE: Clients may send userId/userName/role from legacy UI forms.
// We intentionally DO NOT trust those fields and derive identity from auth context.
export const createTicketSchema = z.object({
  orderId: z.string().min(1).optional(),
  issueType: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),

  userId: z.string().min(1).optional(),
  userName: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(50).optional(),
});

export const updateTicketSchema = z.object({
  status: z.enum(['Open', 'Resolved', 'Rejected']),
});
