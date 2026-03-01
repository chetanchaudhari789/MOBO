-- CreateIndex
CREATE INDEX IF NOT EXISTS "invites_created_at_idx" ON "invites"("created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_deleted_at_created_at_idx" ON "tickets"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_deleted_at_aff_status_created_at_idx" ON "orders"("deleted_at", "affiliate_status", "created_at" DESC);
