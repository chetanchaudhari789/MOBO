-- V4: Add missing indexes for foreign key lookups and common query patterns

-- Brand: ownerUserId FK lookup
CREATE INDEX IF NOT EXISTS "brands_owner_user_id_idx" ON "brands"("owner_user_id");

-- Agency: ownerUserId FK lookup
CREATE INDEX IF NOT EXISTS "agencies_owner_user_id_idx" ON "agencies"("owner_user_id");

-- ShopperProfile: defaultMediatorCode for mediator-scoped queries
CREATE INDEX IF NOT EXISTS "shopper_profiles_default_mediator_code_idx" ON "shopper_profiles"("default_mediator_code");

-- Campaign: standalone status filter
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns"("status");

-- OrderItem: productId for duplicate-deal checks and deal→order lookups
CREATE INDEX IF NOT EXISTS "order_items_product_id_idx" ON "order_items"("product_id");

-- Payout: walletId FK for wallet-scoped payout queries
CREATE INDEX IF NOT EXISTS "payouts_wallet_id_idx" ON "payouts"("wallet_id");
