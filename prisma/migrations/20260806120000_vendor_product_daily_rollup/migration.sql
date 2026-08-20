-- Vendors & POS product breakdown daily rollup (fast insights reads).
CREATE TABLE IF NOT EXISTS "booking_report_vendor_product_daily" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "report_day" DATE NOT NULL,
  "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
  "third_party_vendor_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_label" TEXT NOT NULL,
  "product_kind" VARCHAR(32) NOT NULL,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  "ticket_qty" INTEGER NOT NULL DEFAULT 0,
  "admit_count" INTEGER NOT NULL DEFAULT 0,
  "addon_amount" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "ticket_revenue" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "net_revenue" DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'QAR',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_report_vendor_product_daily_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "booking_report_vendor_product_daily_third_party_vendor_id_fkey"
    FOREIGN KEY ("third_party_vendor_id") REFERENCES "third_party_vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_report_vendor_product_daily_event_id_report_day_report_basis_third_party_vendor_id_product_kind_product_id_currency_key"
  ON "booking_report_vendor_product_daily" (
    "event_id",
    "report_day",
    "report_basis",
    "third_party_vendor_id",
    "product_kind",
    "product_id",
    "currency"
  );

CREATE INDEX IF NOT EXISTS "booking_report_vendor_product_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_vendor_product_daily" ("event_id", "report_day", "report_basis");

CREATE INDEX IF NOT EXISTS "booking_report_vendor_product_daily_third_party_vendor_id_report_day_idx"
  ON "booking_report_vendor_product_daily" ("third_party_vendor_id", "report_day");
