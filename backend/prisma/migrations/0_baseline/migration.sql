node.exe : Loaded Prisma config from prisma.config.ts.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Users\LENOVO\AppData\Roaming ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Loaded Prisma c...isma.config.ts. 
   :String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('shopper', 'mediator', 'agency', 'brand', 'admin', 'ops');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('none', 'pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "brand_status" AS ENUM ('active', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "agency_status" AS ENUM ('active', 'suspended', 'pending');

-- CreateEnum
CREATE TYPE "order_workflow_status" AS ENUM ('CREATED', 'REDIRECTED', 'ORDERED', 'PROOF_SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REWARD_PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('Ordered', 'Shipped', 'Delivered', 'Cancelled', 'Returned');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('Pending', 'Paid', 'Refunded', 'Failed');

-- CreateEnum
CREATE TYPE "affiliate_status" AS ENUM ('Unchecked', 'Pending_Cooling', 'Approved_Settled', 'Rejected', 'Fraud_Alert', 'Cap_Exceeded', 'Frozen_Disputed');

-- CreateEnum
CREATE TYPE "settlement_mode" AS ENUM ('wallet', 'external');

-- CreateEnum
CREATE TYPE "deal_type" AS ENUM ('Discount', 'Review', 'Rating');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('brand_deposit', 'platform_fee', 'commission_lock', 'commission_settle', 'cashback_lock', 'cashback_settle', 'order_settlement_debit', 'commission_reversal', 'margin_reversal', 'agency_payout', 'agency_receipt', 'payout_request', 'payout_complete', 'payout_failed', 'refund');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('pending', 'completed', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('requested', 'processing', 'paid', 'failed', 'canceled', 'recorded');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('INR');

-- CreateEnum
CREATE TYPE "invite_status" AS ENUM ('active', 'used', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('Open', 'Resolved', 'Rejected');

-- CreateEnum
CREATE TYPE "suspension_action" AS ENUM ('suspend', 'unsuspend');

-- CreateEnum
CREATE TYPE "push_app" AS ENUM ('buyer', 'mediator');

-- CreateEnum
CREATE TYPE "rejection_type" AS ENUM ('order', 'review', 'rating', 'returnWindow');

-- CreateEnum
CREATE TYPE "missing_proof_type" AS ENUM ('review', 'rating', 'returnWindow');

-- CreateEnum
CREATE TYPE "mediator_status" AS ENUM ('active', 'suspended', 'pending');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "name" VARCHAR(120) NOT NULL,
    "username" VARCHAR(64),
    "mobile" VARCHAR(10) NOT NULL,
    "email" VARCHAR(320),
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'shopper',
    "roles" "user_role"[] DEFAULT ARRAY['shopper']::"user_role"[],
    "status" "user_status" NOT NULL DEFAULT 'active',
    "mediator_code" VARCHAR(64),
    "parent_code" VARCHAR(64),
    "generated_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_verified_by_mediator" BOOLEAN NOT NULL DEFAULT false,
    "brand_code" VARCHAR(64),
    "connected_agencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kyc_status" "kyc_status" NOT NULL DEFAULT 'none',
    "kyc_pan_card" TEXT,
    "kyc_aadhaar" TEXT,
    "kyc_gst" TEXT,
    "upi_id" TEXT,
    "qr_code" TEXT,
    "bank_account_number" TEXT,
    "bank_ifsc" TEXT,
    "bank_name" TEXT,
    "bank_holder_name" TEXT,
    "wallet_balance_paise" INTEGER NOT NULL DEFAULT 0,
    "wallet_pending_paise" INTEGER NOT NULL DEFAULT 0,
    "avatar" TEXT,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "lockout_until" TIMESTAMP(3),
    "google_refresh_token" TEXT,
    "google_email" VARCHAR(320),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "agency_id" TEXT,
    "agency_name" TEXT,
    "agency_code" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "brand_code" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "connected_agency_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "brand_status" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "name" VARCHAR(200) NOT NULL,
    "agency_code" TEXT NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "status" "agency_status" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mediator_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "mediator_code" TEXT NOT NULL,
    "parent_agency_code" TEXT,
    "status" "mediator_status" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mediator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopper_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "default_mediator_code" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopper_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "brand_user_id" UUID NOT NULL,
    "brand_name" VARCHAR(200) NOT NULL,
    "platform" VARCHAR(80) NOT NULL,
    "image" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "original_price_paise" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "payout_paise" INTEGER NOT NULL,
    "return_window_days" INTEGER NOT NULL DEFAULT 14,
    "deal_type" "deal_type",
    "total_slots" INTEGER NOT NULL,
    "used_slots" INTEGER NOT NULL DEFAULT 0,
    "status" "campaign_status" NOT NULL DEFAULT 'draft',
    "allowed_agency_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignments" JSONB NOT NULL DEFAULT '{}',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "locked_reason" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "campaign_id" UUID NOT NULL,
    "mediator_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT 'Exclusive',
    "image" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "deal_type" "deal_type" NOT NULL,
    "original_price_paise" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "commission_paise" INTEGER NOT NULL,
    "payout_paise" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "category" TEXT NOT NULL DEFAULT 'General',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "brand_user_id" UUID,
    "total_paise" INTEGER NOT NULL,
    "workflow_status" "order_workflow_status" NOT NULL DEFAULT 'CREATED',
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "frozen_reason" TEXT,
    "reactivated_at" TIMESTAMP(3),
    "reactivated_by" UUID,
    "status" "order_status" NOT NULL DEFAULT 'Ordered',
    "payment_status" "payment_status" NOT NULL DEFAULT 'Pending',
    "affiliate_status" "affiliate_status" NOT NULL DEFAULT 'Unchecked',
    "external_order_id" TEXT,
    "order_date" TIMESTAMP(3),
    "sold_by" TEXT,
    "extracted_product_name" TEXT,
    "settlement_ref" TEXT,
    "settlement_mode" "settlement_mode" NOT NULL DEFAULT 'wallet',
    "screenshot_order" TEXT,
    "screenshot_payment" TEXT,
    "screenshot_review" TEXT,
    "screenshot_rating" TEXT,
    "screenshot_return_window" TEXT,
    "review_link" TEXT,
    "return_window_days" INTEGER NOT NULL DEFAULT 14,
    "rating_ai_verification" JSONB,
    "return_window_ai_verification" JSONB,
    "rejection_type" "rejection_type",
    "rejection_reason" TEXT,
    "rejection_at" TIMESTAMP(3),
    "rejection_by" UUID,
    "verification" JSONB,
    "manager_name" TEXT NOT NULL,
    "agency_name" TEXT,
    "buyer_name" TEXT NOT NULL,
    "buyer_mobile" VARCHAR(10) NOT NULL,
    "reviewer_name" TEXT,
    "brand_name" TEXT,
    "events" JSONB NOT NULL DEFAULT '[]',
    "missing_proof_requests" JSONB NOT NULL DEFAULT '[]',
    "expected_settlement_date" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price_at_purchase_paise" INTEGER NOT NULL,
    "commission_paise" INTEGER NOT NULL,
    "campaign_id" UUID NOT NULL,
    "deal_type" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "platform" TEXT,
    "brand_name" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "owner_user_id" UUID NOT NULL,
    "currency" "currency" NOT NULL DEFAULT 'INR',
    "available_paise" INTEGER NOT NULL DEFAULT 0,
    "pending_paise" INTEGER NOT NULL DEFAULT 0,
    "locked_paise" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "type" "transaction_type" NOT NULL,
    "status" "transaction_status" NOT NULL DEFAULT 'pending',
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "order_id" VARCHAR(64),
    "campaign_id" UUID,
    "payout_id" UUID,
    "wallet_id" UUID,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "metadata" JSONB,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "beneficiary_user_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "payout_status" NOT NULL DEFAULT 'requested',
    "provider" TEXT,
    "provider_ref" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "code" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "label" TEXT,
    "parent_user_id" UUID,
    "parent_code" TEXT,
    "status" "invite_status" NOT NULL DEFAULT 'active',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "created_by" UUID,
    "used_by" UUID,
    "used_at" TIMESTAMP(3),
    "uses" JSONB NOT NULL DEFAULT '[]',
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "order_id" TEXT,
    "issue_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ticket_status" NOT NULL DEFAULT 'Open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" VARCHAR(1000),
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "user_id" UUID NOT NULL,
    "app" "push_app" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "expiration_time" INTEGER,
    "keys_p256dh" TEXT NOT NULL,
    "keys_auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suspensions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "target_user_id" UUID NOT NULL,
    "action" "suspension_action" NOT NULL,
    "reason" TEXT,
    "admin_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "actor_user_id" UUID,
    "actor_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mongo_id" TEXT,
    "key" TEXT NOT NULL DEFAULT 'system',
    "admin_contact_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_sync" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "collection" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "synced_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "migration_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_mongo_id_key" ON "users"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_parent_code_idx" ON "users"("parent_code");

-- CreateIndex
CREATE INDEX "users_brand_code_roles_idx" ON "users"("brand_code", "roles");

-- CreateIndex
CREATE INDEX "users_mediator_code_roles_idx" ON "users"("mediator_code", "roles");

-- CreateIndex
CREATE INDEX "users_roles_status_idx" ON "users"("roles", "status");

-- CreateIndex
CREATE INDEX "users_mobile_deleted_at_idx" ON "users"("mobile", "deleted_at");

-- CreateIndex
CREATE INDEX "users_username_deleted_at_idx" ON "users"("username", "deleted_at");

-- CreateIndex
CREATE INDEX "users_deleted_at_created_at_idx" ON "users"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_unique" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "pending_connections_user_id_idx" ON "pending_connections"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_mongo_id_key" ON "brands"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_brand_code_key" ON "brands"("brand_code");

-- CreateIndex
CREATE INDEX "brands_status_created_at_idx" ON "brands"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agencies_mongo_id_key" ON "agencies"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_agency_code_key" ON "agencies"("agency_code");

-- CreateIndex
CREATE INDEX "agencies_status_created_at_idx" ON "agencies"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "mediator_profiles_mongo_id_key" ON "mediator_profiles"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "mediator_profiles_user_id_key" ON "mediator_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mediator_profiles_mediator_code_key" ON "mediator_profiles"("mediator_code");

-- CreateIndex
CREATE UNIQUE INDEX "shopper_profiles_mongo_id_key" ON "shopper_profiles"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopper_profiles_user_id_key" ON "shopper_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_mongo_id_key" ON "campaigns"("mongo_id");

-- CreateIndex
CREATE INDEX "campaigns_status_brand_user_id_created_at_idx" ON "campaigns"("status", "brand_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "campaigns_deleted_at_created_at_idx" ON "campaigns"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deals_mongo_id_key" ON "deals"("mongo_id");

-- CreateIndex
CREATE INDEX "deals_mediator_code_created_at_idx" ON "deals"("mediator_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deals_active_idx" ON "deals"("active");

-- CreateIndex
CREATE UNIQUE INDEX "deals_campaign_id_mediator_code_key" ON "deals"("campaign_id", "mediator_code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_mongo_id_key" ON "orders"("mongo_id");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_manager_name_created_at_idx" ON "orders"("manager_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_brand_user_id_created_at_idx" ON "orders"("brand_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_workflow_status_idx" ON "orders"("workflow_status");

-- CreateIndex
CREATE INDEX "orders_frozen_idx" ON "orders"("frozen");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_affiliate_status_idx" ON "orders"("affiliate_status");

-- CreateIndex
CREATE INDEX "orders_settlement_mode_idx" ON "orders"("settlement_mode");

-- CreateIndex
CREATE INDEX "orders_deleted_at_created_at_idx" ON "orders"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_external_order_id_idx" ON "orders"("external_order_id");

-- CreateIndex
CREATE INDEX "orders_user_id_workflow_status_deleted_at_idx" ON "orders"("user_id", "workflow_status", "deleted_at");

-- CreateIndex
CREATE INDEX "orders_brand_user_id_workflow_status_deleted_at_idx" ON "orders"("brand_user_id", "workflow_status", "deleted_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_campaign_id_idx" ON "order_items"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_mongo_id_key" ON "wallets"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_user_id_key" ON "wallets"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_mongo_id_key" ON "transactions"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_status_type_created_at_idx" ON "transactions"("status", "type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_deleted_at_created_at_idx" ON "transactions"("deleted_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_wallet_id_created_at_idx" ON "transactions"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_order_id_idx" ON "transactions"("order_id");

-- CreateIndex
CREATE INDEX "transactions_campaign_id_idx" ON "transactions"("campaign_id");

-- CreateIndex
CREATE INDEX "transactions_payout_id_idx" ON "transactions"("payout_id");

-- CreateIndex
CREATE INDEX "transactions_from_user_id_idx" ON "transactions"("from_user_id");

-- CreateIndex
CREATE INDEX "transactions_to_user_id_idx" ON "transactions"("to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_mongo_id_key" ON "payouts"("mongo_id");

-- CreateIndex
CREATE INDEX "payouts_status_requested_at_idx" ON "payouts"("status", "requested_at" DESC);

-- CreateIndex
CREATE INDEX "payouts_beneficiary_user_id_requested_at_idx" ON "payouts"("beneficiary_user_id", "requested_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_provider_ref_key" ON "payouts"("provider", "provider_ref");

-- CreateIndex
CREATE UNIQUE INDEX "invites_mongo_id_key" ON "invites"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_code_key" ON "invites"("code");

-- CreateIndex
CREATE INDEX "invites_status_expires_at_idx" ON "invites"("status", "expires_at");

-- CreateIndex
CREATE INDEX "invites_code_status_use_count_idx" ON "invites"("code", "status", "use_count");

-- CreateIndex
CREATE INDEX "invites_parent_code_status_created_at_idx" ON "invites"("parent_code", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_mongo_id_key" ON "tickets"("mongo_id");

-- CreateIndex
CREATE INDEX "tickets_status_created_at_idx" ON "tickets"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tickets_user_id_deleted_at_created_at_idx" ON "tickets"("user_id", "deleted_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_mongo_id_key" ON "push_subscriptions"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_app_idx" ON "push_subscriptions"("user_id", "app");

-- CreateIndex
CREATE UNIQUE INDEX "suspensions_mongo_id_key" ON "suspensions"("mongo_id");

-- CreateIndex
CREATE INDEX "suspensions_target_user_id_created_at_idx" ON "suspensions"("target_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_mongo_id_key" ON "audit_logs"("mongo_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_action_idx" ON "audit_logs"("created_at" DESC, "action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_mongo_id_key" ON "system_configs"("mongo_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_key_key" ON "system_configs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "migration_sync_collection_key" ON "migration_sync"("collection");

-- CreateIndex
CREATE INDEX "migration_sync_status_idx" ON "migration_sync"("status");

-- AddForeignKey
ALTER TABLE "pending_connections" ADD CONSTRAINT "pending_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mediator_profiles" ADD CONSTRAINT "mediator_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopper_profiles" ADD CONSTRAINT "shopper_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_brand_user_id_fkey" FOREIGN KEY ("brand_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiary_user_id_fkey" FOREIGN KEY ("beneficiary_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

