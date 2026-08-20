-- CreateEnum
CREATE TYPE "DailyClosingStatus" AS ENUM ('generated', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('generated', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" UUID NOT NULL,
    "closing_code" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "organization_id" UUID,
    "closing_for_date" DATE NOT NULL,
    "received_cash_amount" DECIMAL(12,3) NOT NULL,
    "received_card_amount" DECIMAL(12,3) NOT NULL,
    "total_cash_sale" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_card_sale" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cash_flow_balance" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "card_flow_balance" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reject_reason" TEXT,
    "status" "DailyClosingStatus" NOT NULL DEFAULT 'generated',
    "signature_media_id" UUID,
    "signed_pdf_media_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closing_status_histories" (
    "id" UUID NOT NULL,
    "daily_closing_id" UUID NOT NULL,
    "closing_code" TEXT NOT NULL,
    "status" "DailyClosingStatus" NOT NULL,
    "cash_flow_balance" DECIMAL(12,3) NOT NULL,
    "card_flow_balance" DECIMAL(12,3) NOT NULL,
    "received_cash_amount" DECIMAL(12,3) NOT NULL,
    "received_card_amount" DECIMAL(12,3) NOT NULL,
    "total_cash_sale" DECIMAL(12,3) NOT NULL,
    "total_card_sale" DECIMAL(12,3) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reject_reason" TEXT,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_closing_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "settlement_by_id" UUID NOT NULL,
    "organization_id" UUID,
    "settlement_for_date" DATE NOT NULL,
    "received_cash_amount" DECIMAL(12,3) NOT NULL,
    "received_card_amount" DECIMAL(12,3) NOT NULL,
    "booking_cash_sale" DECIMAL(12,3) NOT NULL,
    "booking_card_sale" DECIMAL(12,3) NOT NULL,
    "discrepancy_cash_amount" DECIMAL(12,3) NOT NULL,
    "discrepancy_card_amount" DECIMAL(12,3) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'generated',
    "signature_media_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "daily_closings_agent_id_closing_for_date_idx" ON "daily_closings"("agent_id", "closing_for_date");
CREATE INDEX "daily_closings_closing_for_date_status_idx" ON "daily_closings"("closing_for_date", "status");
CREATE INDEX "daily_closings_organization_id_closing_for_date_idx" ON "daily_closings"("organization_id", "closing_for_date");
CREATE INDEX "daily_closings_deleted_at_idx" ON "daily_closings"("deleted_at");
CREATE UNIQUE INDEX "daily_closings_agent_date_active_uidx" ON "daily_closings"("agent_id", "closing_for_date") WHERE "deleted_at" IS NULL;

CREATE INDEX "daily_closing_status_histories_daily_closing_id_created_at_idx" ON "daily_closing_status_histories"("daily_closing_id", "created_at");

CREATE UNIQUE INDEX "settlements_settlement_by_id_settlement_for_date_key" ON "settlements"("settlement_by_id", "settlement_for_date");
CREATE INDEX "settlements_settlement_for_date_status_idx" ON "settlements"("settlement_for_date", "status");
CREATE INDEX "settlements_organization_id_settlement_for_date_idx" ON "settlements"("organization_id", "settlement_for_date");

-- ForeignKeys
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_signature_media_id_fkey" FOREIGN KEY ("signature_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_signed_pdf_media_id_fkey" FOREIGN KEY ("signed_pdf_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_closing_status_histories" ADD CONSTRAINT "daily_closing_status_histories_daily_closing_id_fkey" FOREIGN KEY ("daily_closing_id") REFERENCES "daily_closings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_closing_status_histories" ADD CONSTRAINT "daily_closing_status_histories_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settlement_by_id_fkey" FOREIGN KEY ("settlement_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_signature_media_id_fkey" FOREIGN KEY ("signature_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
