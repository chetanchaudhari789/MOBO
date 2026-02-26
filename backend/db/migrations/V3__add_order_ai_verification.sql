-- Add order_ai_verification column (mirrors Prisma migration 20260226235614)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_ai_verification" JSONB;
