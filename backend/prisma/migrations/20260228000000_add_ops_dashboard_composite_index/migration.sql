-- Add composite index for ops dashboard filtered listing (managerName + deletedAt + createdAt desc)
CREATE INDEX IF NOT EXISTS "orders_manager_name_deleted_at_created_at_idx"
  ON "orders"("manager_name", "deleted_at", "created_at" DESC);
