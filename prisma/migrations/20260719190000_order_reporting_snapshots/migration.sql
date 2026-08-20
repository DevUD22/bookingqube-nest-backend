-- Reporting v2: denormalized order snapshots + dimensional rollups + idempotent ledger

CREATE TYPE "VisitorType" AS ENUM ('paid', 'promocode', 'comp', 'special_need', 'comp_promo', 'third_party', 'pos_only');
CREATE TYPE "ReportPaymentMode" AS ENUM ('online', 'offline_cash', 'offline_card', 'split', 'comp', 'free');
CREATE TYPE "PaymentLegType" AS ENUM ('cash', 'card', 'online_gateway', 'comp', 'other');

-- Expand booking_report_daily (payment_mode was free text)
ALTER TABLE "booking_report_daily" ADD COLUMN IF NOT EXISTS "ticket_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "booking_report_daily" ADD COLUMN IF NOT EXISTS "tickets_net" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "booking_report_daily" ADD COLUMN IF NOT EXISTS "addons_net" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- Normalize existing payment_mode strings then cast to enum
UPDATE "booking_report_daily"
SET "payment_mode" = CASE
  WHEN "payment_mode" IN ('online', 'paid') THEN 'online'
  WHEN "payment_mode" IN ('offline_cash', 'cash') THEN 'offline_cash'
  WHEN "payment_mode" IN ('offline_card', 'card') THEN 'offline_card'
  WHEN "payment_mode" = 'split' THEN 'split'
  WHEN "payment_mode" IN ('comp', 'complimentary') THEN 'comp'
  WHEN "payment_mode" = 'free' THEN 'free'
  ELSE 'online'
END;

ALTER TABLE "booking_report_daily"
  ALTER COLUMN "payment_mode" TYPE "ReportPaymentMode"
  USING ("payment_mode"::"ReportPaymentMode");

CREATE TABLE "booking_report_payment_daily" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "payment_method_label" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "admit_count" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_report_payment_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_report_visitor_daily" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "visitor_type" "VisitorType" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "admit_count" INTEGER NOT NULL DEFAULT 0,
    "ticket_qty" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_report_visitor_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_report_ledger" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "action_key" TEXT NOT NULL,
    "report_version" INTEGER NOT NULL,
    "deltas_json" JSONB NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_report_ledger_pkey" PRIMARY KEY ("id")
);

-- Order snapshot columns (nullable first, backfill, then NOT NULL)
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "organization_id" UUID,
  ADD COLUMN IF NOT EXISTS "venue_id" UUID,
  ADD COLUMN IF NOT EXISTS "event_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "event_title" TEXT,
  ADD COLUMN IF NOT EXISTS "event_start_date" DATE,
  ADD COLUMN IF NOT EXISTS "event_start_time" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_email" CITEXT,
  ADD COLUMN IF NOT EXISTS "customer_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_age_group" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_geographic_region" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_gender" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_mode" "ReportPaymentMode" NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS "payment_method_label" TEXT NOT NULL DEFAULT 'Online',
  ADD COLUMN IF NOT EXISTS "tickets_net" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "addons_net" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "extensions_net" DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_admits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_summer_camp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "report_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "report_sync_pending" BOOLEAN NOT NULL DEFAULT false;

UPDATE "orders" o
SET
  "organization_id" = e."organization_id",
  "venue_id" = e."venue_id",
  "event_slug" = e."slug",
  "event_title" = COALESCE(
    (SELECT et."title" FROM "event_translations" et WHERE et."event_id" = e."id" AND et."locale" = 'en' LIMIT 1),
    (SELECT et."title" FROM "event_translations" et WHERE et."event_id" = e."id" LIMIT 1),
    e."slug"
  ),
  "customer_name" = u."name",
  "customer_email" = u."email",
  "customer_phone" = u."phone",
  "is_summer_camp" = (e."event_type" = 'summer_camp'),
  "tickets_net" = COALESCE((
    SELECT SUM(oi."total_amount") FROM "order_items" oi
    WHERE oi."order_id" = o."id" AND oi."item_type" IN ('ticket_type', 'ticket_variant')
  ), 0),
  "addons_net" = COALESCE((
    SELECT SUM(oi."total_amount") FROM "order_items" oi
    WHERE oi."order_id" = o."id" AND oi."item_type" IN ('addon', 'addon_variant')
  ), 0),
  "total_quantity" = COALESCE((
    SELECT SUM(oi."quantity") FROM "order_items" oi
    WHERE oi."order_id" = o."id" AND oi."item_type" IN ('ticket_type', 'ticket_variant')
  ), 0),
  "total_admits" = COALESCE((
    SELECT SUM(oi."quantity") FROM "order_items" oi
    WHERE oi."order_id" = o."id" AND oi."item_type" IN ('ticket_type', 'ticket_variant')
  ), 0),
  "payment_mode" = CASE
    WHEN o."total_amount" = 0 THEN 'free'::"ReportPaymentMode"
    WHEN o."source" = 'pos' THEN 'offline_cash'::"ReportPaymentMode"
    ELSE 'online'::"ReportPaymentMode"
  END,
  "payment_method_label" = CASE
    WHEN o."total_amount" = 0 THEN 'Free'
    WHEN o."source" = 'pos' THEN 'Cash'
    ELSE 'Online'
  END,
  "event_start_date" = (
    SELECT ed."date" FROM "event_sessions" es
    JOIN "event_dates" ed ON ed."id" = es."event_date_id"
    WHERE es."id" = o."event_session_id"
    LIMIT 1
  ),
  "event_start_time" = (
    SELECT es."display_time" FROM "event_sessions" es
    WHERE es."id" = o."event_session_id"
    LIMIT 1
  )
FROM "events" e, "users" u
WHERE e."id" = o."event_id" AND u."id" = o."customer_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "orders"
    WHERE "organization_id" IS NULL
       OR "event_slug" IS NULL
       OR "event_title" IS NULL
       OR "customer_name" IS NULL
       OR "customer_email" IS NULL
  ) THEN
    RAISE EXCEPTION 'orders snapshot backfill incomplete; fix orphan orders before migrating';
  END IF;
END $$;

ALTER TABLE "orders"
  ALTER COLUMN "organization_id" SET NOT NULL,
  ALTER COLUMN "event_slug" SET NOT NULL,
  ALTER COLUMN "event_title" SET NOT NULL,
  ALTER COLUMN "customer_name" SET NOT NULL,
  ALTER COLUMN "customer_email" SET NOT NULL;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "visitor_type" "VisitorType" NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS "venue_share_id" UUID,
  ADD COLUMN IF NOT EXISTS "admit_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "ticket_is_cafe" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ticket_is_pos_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ticket_hide_from_online" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "leg_type" "PaymentLegType" NOT NULL DEFAULT 'online_gateway';

-- FKs and indexes
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_venue_id_fkey"
  FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_venue_share_id_fkey"
  FOREIGN KEY ("venue_share_id") REFERENCES "venue_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_report_payment_daily"
  ADD CONSTRAINT "booking_report_payment_daily_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_report_visitor_daily"
  ADD CONSTRAINT "booking_report_visitor_daily_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_report_ledger"
  ADD CONSTRAINT "order_report_ledger_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "booking_report_payment_daily_event_id_report_day_payment_method_label_currency_key"
  ON "booking_report_payment_daily"("event_id", "report_day", "payment_method_label", "currency");
CREATE INDEX "booking_report_payment_daily_event_id_report_day_idx"
  ON "booking_report_payment_daily"("event_id", "report_day");

CREATE UNIQUE INDEX "booking_report_visitor_daily_event_id_report_day_visitor_type_currency_key"
  ON "booking_report_visitor_daily"("event_id", "report_day", "visitor_type", "currency");
CREATE INDEX "booking_report_visitor_daily_event_id_report_day_idx"
  ON "booking_report_visitor_daily"("event_id", "report_day");
CREATE INDEX "booking_report_visitor_daily_visitor_type_idx"
  ON "booking_report_visitor_daily"("visitor_type");

CREATE UNIQUE INDEX "order_report_ledger_order_id_action_key_key"
  ON "order_report_ledger"("order_id", "action_key");
CREATE INDEX "order_report_ledger_applied_at_idx" ON "order_report_ledger"("applied_at");

CREATE INDEX "orders_organization_id_event_start_date_idx" ON "orders"("organization_id", "event_start_date");
CREATE INDEX "orders_organization_id_created_at_idx" ON "orders"("organization_id", "created_at");
CREATE INDEX "orders_event_id_status_created_at_idx" ON "orders"("event_id", "status", "created_at");
CREATE INDEX "orders_event_id_payment_mode_idx" ON "orders"("event_id", "payment_mode");
CREATE INDEX "orders_venue_id_created_at_idx" ON "orders"("venue_id", "created_at");
CREATE INDEX "orders_report_sync_pending_idx" ON "orders"("report_sync_pending");

CREATE INDEX "order_items_event_id_visitor_type_idx" ON "order_items"("event_id", "visitor_type");
CREATE INDEX "order_items_venue_share_id_idx" ON "order_items"("venue_share_id");
CREATE INDEX "payments_leg_type_idx" ON "payments"("leg_type");

CREATE INDEX "orders_paid_status_created_at_idx" ON "orders"("created_at")
  WHERE "status" IN ('paid', 'refunded', 'partially_refunded');
