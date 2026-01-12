import { z } from 'zod';

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  image: z.string().min(1),
  priceAtPurchase: z.number().nonnegative(),
  commission: z.number().nonnegative(),
  campaignId: z.string().min(1),
  dealType: z.string().min(1),
  quantity: z.number().int().min(1),
  platform: z.string().optional(),
  brandName: z.string().optional(),
});

export const createOrderSchema = z.object({
  userId: z.string().min(1),
  preOrderId: z.string().min(1).optional(),
  items: z.array(orderItemSchema).min(1),
  screenshots: z
    .object({
      order: z.string().optional(),
      payment: z.string().optional(),
      review: z.string().optional(),
      rating: z.string().optional(),
    })
    .optional(),
  externalOrderId: z.string().min(1).max(128).optional(),
  reviewLink: z.string().min(1).max(2000).optional(),
});

export const submitClaimSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(['review', 'rating', 'order']),
  data: z.string().min(1),
});
