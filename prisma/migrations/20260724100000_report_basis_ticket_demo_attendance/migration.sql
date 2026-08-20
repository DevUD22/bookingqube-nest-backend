-- ReportBasis + attendance counters + ticket/demo dailies; add report_basis to existing rollups

DO $$ BEGIN
  CREATE TYPE "ReportBasis" AS ENUM ('trx', 'event');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- EventAttendanceCounter
CREATE TABLE IF NOT EXISTS "event_attendance_counters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "checked_in_count" INTEGER NOT NULL DEFAULT 0,
  "checked_out_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_attendance_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "event_attendance_counters_event_id_key"
  ON "event_attendance_counters"("event_id");

DO $$ BEGIN
  ALTER TABLE "event_attendance_counters"
    ADD CONSTRAINT "event_attendance_counters_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- booking_report_daily: add report_basis
ALTER TABLE "booking_report_daily"
  ADD COLUMN IF NOT EXISTS "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx';

DROP INDEX IF EXISTS "booking_report_daily_event_id_report_day_payment_mode_curren_key";
DROP INDEX IF EXISTS "booking_report_daily_event_id_report_day_idx";
DROP INDEX IF EXISTS "booking_report_daily_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_daily_event_id_report_day_report_basis_payment_mode_currency_key"
  ON "booking_report_daily"("event_id", "report_day", "report_basis", "payment_mode", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_daily"("event_id", "report_day", "report_basis");
CREATE INDEX IF NOT EXISTS "booking_report_daily_report_day_report_basis_idx"
  ON "booking_report_daily"("report_day", "report_basis");

-- booking_report_payment_daily
ALTER TABLE "booking_report_payment_daily"
  ADD COLUMN IF NOT EXISTS "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx';

DROP INDEX IF EXISTS "booking_report_payment_daily_event_id_report_day_payment_method_label_currency_key";
DROP INDEX IF EXISTS "booking_report_payment_daily_event_id_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_payment_daily_event_id_report_day_report_basis_payment_method_label_currency_key"
  ON "booking_report_payment_daily"("event_id", "report_day", "report_basis", "payment_method_label", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_payment_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_payment_daily"("event_id", "report_day", "report_basis");

-- booking_report_visitor_daily
ALTER TABLE "booking_report_visitor_daily"
  ADD COLUMN IF NOT EXISTS "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx';

DROP INDEX IF EXISTS "booking_report_visitor_daily_event_id_report_day_visitor_type_currency_key";
DROP INDEX IF EXISTS "booking_report_visitor_daily_event_id_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_visitor_daily_event_id_report_day_report_basis_visitor_type_currency_key"
  ON "booking_report_visitor_daily"("event_id", "report_day", "report_basis", "visitor_type", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_visitor_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_visitor_daily"("event_id", "report_day", "report_basis");

-- booking_report_pos_daily
ALTER TABLE "booking_report_pos_daily"
  ADD COLUMN IF NOT EXISTS "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx';

DROP INDEX IF EXISTS "booking_report_pos_daily_event_id_report_day_booked_by_agent_id_payment_mode_currency_key";
DROP INDEX IF EXISTS "booking_report_pos_daily_event_id_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_pos_daily_event_id_report_day_report_basis_booked_by_agent_id_payment_mode_currency_key"
  ON "booking_report_pos_daily"("event_id", "report_day", "report_basis", "booked_by_agent_id", "payment_mode", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_pos_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_pos_daily"("event_id", "report_day", "report_basis");

-- booking_report_venue_share_daily
ALTER TABLE "booking_report_venue_share_daily"
  ADD COLUMN IF NOT EXISTS "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx';

DROP INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_venue_share_id_currency_key";
DROP INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_venue_share_daily_event_id_report_day_report_basis_venue_share_id_currency_key"
  ON "booking_report_venue_share_daily"("event_id", "report_day", "report_basis", "venue_share_id", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_venue_share_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_venue_share_daily"("event_id", "report_day", "report_basis");

-- booking_report_ticket_daily
CREATE TABLE IF NOT EXISTS "booking_report_ticket_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "report_day" DATE NOT NULL,
  "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
  "ticket_item_id" UUID NOT NULL,
  "ticket_label" TEXT NOT NULL,
  "item_type" "OrderItemType" NOT NULL,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  "ticket_qty" INTEGER NOT NULL DEFAULT 0,
  "admit_count" INTEGER NOT NULL DEFAULT 0,
  "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_report_ticket_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_ticket_daily_event_id_report_day_report_basis_ticket_item_id_currency_key"
  ON "booking_report_ticket_daily"("event_id", "report_day", "report_basis", "ticket_item_id", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_ticket_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_ticket_daily"("event_id", "report_day", "report_basis");
CREATE INDEX IF NOT EXISTS "booking_report_ticket_daily_ticket_item_id_idx"
  ON "booking_report_ticket_daily"("ticket_item_id");

DO $$ BEGIN
  ALTER TABLE "booking_report_ticket_daily"
    ADD CONSTRAINT "booking_report_ticket_daily_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- booking_report_demo_daily
CREATE TABLE IF NOT EXISTS "booking_report_demo_daily" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "report_day" DATE NOT NULL,
  "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
  "age_group" TEXT NOT NULL DEFAULT 'Unknown',
  "region" TEXT NOT NULL DEFAULT 'Unknown',
  "order_count" INTEGER NOT NULL DEFAULT 0,
  "admit_count" INTEGER NOT NULL DEFAULT 0,
  "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_report_demo_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_demo_daily_event_id_report_day_report_basis_age_group_region_currency_key"
  ON "booking_report_demo_daily"("event_id", "report_day", "report_basis", "age_group", "region", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_demo_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_demo_daily"("event_id", "report_day", "report_basis");
CREATE INDEX IF NOT EXISTS "booking_report_demo_daily_age_group_idx"
  ON "booking_report_demo_daily"("age_group");
CREATE INDEX IF NOT EXISTS "booking_report_demo_daily_region_idx"
  ON "booking_report_demo_daily"("region");

DO $$ BEGIN
  ALTER TABLE "booking_report_demo_daily"
    ADD CONSTRAINT "booking_report_demo_daily_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
