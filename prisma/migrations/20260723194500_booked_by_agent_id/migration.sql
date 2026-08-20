-- Rename Order.sold_by_user_id to booked_by_agent_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'sold_by_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'booked_by_agent_id'
  ) THEN
    ALTER TABLE "orders" RENAME COLUMN "sold_by_user_id" TO "booked_by_agent_id";
  END IF;
END $$;

DROP INDEX IF EXISTS "orders_sold_by_user_id_paid_at_idx";
DROP INDEX IF EXISTS "orders_event_id_sold_by_user_id_paid_at_idx";
CREATE INDEX IF NOT EXISTS "orders_booked_by_agent_id_paid_at_idx" ON "orders"("booked_by_agent_id", "paid_at");
CREATE INDEX IF NOT EXISTS "orders_event_id_booked_by_agent_id_paid_at_idx" ON "orders"("event_id", "booked_by_agent_id", "paid_at");

DO $$ BEGIN
  ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_sold_by_user_id_fkey";
EXCEPTION WHEN undefined_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_booked_by_agent_id_fkey"
    FOREIGN KEY ("booked_by_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- OrderItem.booked_by_agent_id
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "booked_by_agent_id" UUID;

CREATE INDEX IF NOT EXISTS "order_items_booked_by_agent_id_created_at_idx"
  ON "order_items"("booked_by_agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_items_event_id_booked_by_agent_id_idx"
  ON "order_items"("event_id", "booked_by_agent_id");

DO $$ BEGIN
  ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_booked_by_agent_id_fkey"
    FOREIGN KEY ("booked_by_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "order_items" oi
SET "booked_by_agent_id" = o."booked_by_agent_id"
FROM "orders" o
WHERE oi."order_id" = o."id"
  AND oi."booked_by_agent_id" IS NULL
  AND o."booked_by_agent_id" IS NOT NULL;

-- Rename BookingReportPosDaily.sold_by_user_id to booked_by_agent_id
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_report_pos_daily' AND column_name = 'sold_by_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_report_pos_daily' AND column_name = 'booked_by_agent_id'
  ) THEN
    ALTER TABLE "booking_report_pos_daily" RENAME COLUMN "sold_by_user_id" TO "booked_by_agent_id";
  END IF;
END $$;

DROP INDEX IF EXISTS "booking_report_pos_daily_event_id_report_day_sold_by_user_id_payment_mode_currency_key";
DROP INDEX IF EXISTS "booking_report_pos_daily_sold_by_user_id_report_day_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_pos_daily_event_id_report_day_booked_by_agent_id_payment_mode_currency_key"
  ON "booking_report_pos_daily"("event_id", "report_day", "booked_by_agent_id", "payment_mode", "currency");
CREATE INDEX IF NOT EXISTS "booking_report_pos_daily_booked_by_agent_id_report_day_idx"
  ON "booking_report_pos_daily"("booked_by_agent_id", "report_day");
