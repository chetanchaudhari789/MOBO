-- ═══════════════════════════════════════════════════════════════════════════════
-- V2: AI Extraction Caching
-- ═══════════════════════════════════════════════════════════════════════════════
-- Date: 2026-02-25
-- Purpose: Add AI extraction caching to prevent repeated Gemini API calls.
--          Each proof type stores its full extraction result as JSONB so every
--          subsequent view serves the cached result instead of re-calling the API.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "order_ai_extraction"         JSONB,
  ADD COLUMN IF NOT EXISTS "payment_ai_extraction"       JSONB,
  ADD COLUMN IF NOT EXISTS "review_ai_extraction"        JSONB,
  ADD COLUMN IF NOT EXISTS "rating_ai_extraction"        JSONB,
  ADD COLUMN IF NOT EXISTS "return_window_ai_extraction"  JSONB,
  ADD COLUMN IF NOT EXISTS "order_extracted_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_extracted_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_extracted_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rating_extracted_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "return_window_extracted_at"   TIMESTAMP(3);
