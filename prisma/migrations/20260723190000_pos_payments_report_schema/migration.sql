-- AlterEnum: ReportPaymentMode.advance
ALTER TYPE "ReportPaymentMode" ADD VALUE IF NOT EXISTS 'advance';

-- CreateEnum: AdvancePaymentStatus
DO $$ BEGIN
  CREATE TYPE "AdvancePaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Order denormalized POS / tender amounts
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "cash_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "card_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "online_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "comp_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sold_by_user_id" UUID;

CREATE INDEX IF NOT EXISTS "orders_sold_by_user_id_paid_at_idx" ON "orders"("sold_by_user_id", "paid_at");
CREATE INDEX IF NOT EXISTS "orders_event_id_sold_by_user_id_paid_at_idx" ON "orders"("event_id", "sold_by_user_id", "paid_at");
CREATE INDEX IF NOT EXISTS "orders_organization_id_payment_mode_paid_at_idx" ON "orders"("organization_id", "payment_mode", "paid_at");

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_sold_by_user_id_fkey"
    FOREIGN KEY ("sold_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Payment collected_by
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "collected_by_user_id" UUID;

CREATE INDEX IF NOT EXISTS "payments_collected_by_user_id_paid_at_idx" ON "payments"("collected_by_user_id", "paid_at");

DO $$ BEGIN
  ALTER TABLE "payments"
    ADD CONSTRAINT "payments_collected_by_user_id_fkey"
    FOREIGN KEY ("collected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- BookingReportPosDaily
CREATE TABLE IF NOT EXISTS "booking_report_pos_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "report_day" DATE NOT NULL,
  "sold_by_user_id" UUID NOT NULL,
  "payment_mode" "ReportPaymentMode" NOT NULL,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  "admit_count" INTEGER NOT NULL DEFAULT 0,
  "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "cash_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "card_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_report_pos_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_pos_daily_event_id_report_day_sold_by_user_id_payment_mode_currency_key"
  ON "booking_report_pos_daily"("event_id", "report_day", "sold_by_user_id", "payment_mode", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_pos_daily_event_id_report_day_idx"
  ON "booking_report_pos_daily"("event_id", "report_day");
CREATE INDEX IF NOT EXISTS "booking_report_pos_daily_sold_by_user_id_report_day_idx"
  ON "booking_report_pos_daily"("sold_by_user_id", "report_day");

DO $$ BEGIN
  ALTER TABLE "booking_report_pos_daily"
    ADD CONSTRAINT "booking_report_pos_daily_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- BookingReportVenueShareDaily
CREATE TABLE IF NOT EXISTS "booking_report_venue_share_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "report_day" DATE NOT NULL,
  "venue_share_id" UUID NOT NULL,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  "ticket_qty" INTEGER NOT NULL DEFAULT 0,
  "admit_count" INTEGER NOT NULL DEFAULT 0,
  "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_report_venue_share_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_venue_share_daily_event_id_report_day_venue_share_id_currency_key"
  ON "booking_report_venue_share_daily"("event_id", "report_day", "venue_share_id", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_venue_share_daily_event_id_report_day_idx"
  ON "booking_report_venue_share_daily"("event_id", "report_day");
CREATE INDEX IF NOT EXISTS "booking_report_venue_share_daily_venue_share_id_report_day_idx"
  ON "booking_report_venue_share_daily"("venue_share_id", "report_day");

DO $$ BEGIN
  ALTER TABLE "booking_report_venue_share_daily"
    ADD CONSTRAINT "booking_report_venue_share_daily_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "booking_report_venue_share_daily"
    ADD CONSTRAINT "booking_report_venue_share_daily_venue_share_id_fkey"
    FOREIGN KEY ("venue_share_id") REFERENCES "venue_shares"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AdvancePayment
CREATE TABLE IF NOT EXISTS "advance_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "common_order" TEXT NOT NULL,
  "event_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "venue_id" UUID,
  "hold_id" UUID,
  "customer_id" UUID,
  "customer_name" TEXT NOT NULL,
  "customer_email" CITEXT NOT NULL,
  "customer_phone" TEXT,
  "booking_data" JSONB NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "total_amount" DECIMAL(12,3) NOT NULL,
  "advance_amount" DECIMAL(12,3) NOT NULL,
  "remaining_amount" DECIMAL(12,3) NOT NULL,
  "advance_leg_type" "PaymentLegType" NOT NULL,
  "completed_leg_type" "PaymentLegType",
  "initiated_by_user_id" UUID NOT NULL,
  "completed_by_user_id" UUID,
  "status" "AdvancePaymentStatus" NOT NULL DEFAULT 'PENDING',
  "order_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "advance_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "advance_payments_common_order_key" ON "advance_payments"("common_order");
CREATE INDEX IF NOT EXISTS "advance_payments_status_event_id_idx" ON "advance_payments"("status", "event_id");
CREATE INDEX IF NOT EXISTS "advance_payments_common_order_idx" ON "advance_payments"("common_order");
CREATE INDEX IF NOT EXISTS "advance_payments_initiated_by_user_id_created_at_idx" ON "advance_payments"("initiated_by_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "advance_payments_event_id_created_at_idx" ON "advance_payments"("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "advance_payments_customer_email_idx" ON "advance_payments"("customer_email");

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_venue_id_fkey"
    FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_hold_id_fkey"
    FOREIGN KEY ("hold_id") REFERENCES "ticket_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_initiated_by_user_id_fkey"
    FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_completed_by_user_id_fkey"
    FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
