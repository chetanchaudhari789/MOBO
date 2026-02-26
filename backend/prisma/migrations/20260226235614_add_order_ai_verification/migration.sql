-- AlterTable: Add order_ai_verification column
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_ai_verification" JSONB;
