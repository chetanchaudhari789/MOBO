import { z } from 'zod';

export const updateSystemConfigSchema = z.object({
  adminContactEmail: z.string().email().optional(),
});
