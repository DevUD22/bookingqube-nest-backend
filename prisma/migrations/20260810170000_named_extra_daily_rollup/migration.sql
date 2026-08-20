-- Named addon / time-extension detail rollup (qty sold). Additive to vendor-product money rollups.
CREATE TABLE IF NOT EXISTS "booking_report_named_extra_daily" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
    "third_party_vendor_id" UUID NOT NULL,
    "product_kind" VARCHAR(32) NOT NULL,
    "name_key" VARCHAR(190) NOT NULL,
    "product_id" UUID NOT NULL,
    "product_label" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "item_qty" INTEGER NOT NULL DEFAULT 0,
    "with_ticket_qty" INTEGER NOT NULL DEFAULT 0,
    "standalone_qty" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_named_extra_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_named_extra_daily_event_id_report_day_report_ba_key"
ON "booking_report_named_extra_daily"("event_id", "report_day", "report_basis", "third_party_vendor_id", "product_kind", "name_key", "currency");

CREATE INDEX IF NOT EXISTS "booking_report_named_extra_daily_event_id_report_day_report_ba_idx"
ON "booking_report_named_extra_daily"("event_id", "report_day", "report_basis");

CREATE INDEX IF NOT EXISTS "booking_report_named_extra_daily_event_id_product_kind_name_ke_idx"
ON "booking_report_named_extra_daily"("event_id", "product_kind", "name_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_report_named_extra_daily_event_id_fkey'
  ) THEN
    ALTER TABLE "booking_report_named_extra_daily"
      ADD CONSTRAINT "booking_report_named_extra_daily_event_id_fkey"
      FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
