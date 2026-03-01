-- Add composite index for Deal queries filtered by mediatorCode + deletedAt + active
-- This optimizes the heavily-used listProducts endpoint
CREATE INDEX IF NOT EXISTS "deals_mediator_code_deleted_at_active_idx"
  ON "deals"("mediator_code", "deleted_at", "active");
