-- Cafe insights rollups (dashboard/event-report speed parity).
CREATE TABLE "booking_report_cafe_daily" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
    "payment_mode" "ReportPaymentMode" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "item_qty" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "card_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "online_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_cafe_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_report_cafe_agent_daily" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
    "booked_by_agent_id" UUID NOT NULL,
    "payment_mode" "ReportPaymentMode" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "item_qty" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "card_amount" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_cafe_agent_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_report_cafe_item_daily" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "report_basis" "ReportBasis" NOT NULL DEFAULT 'trx',
    "menu_item_id" UUID NOT NULL,
    "item_label" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "item_qty" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_cafe_item_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_report_cafe_daily_cafe_id_event_id_report_day_report_basis_payment_mode_currency_key"
  ON "booking_report_cafe_daily"("cafe_id", "event_id", "report_day", "report_basis", "payment_mode", "currency");
CREATE INDEX "booking_report_cafe_daily_cafe_id_report_day_report_basis_idx"
  ON "booking_report_cafe_daily"("cafe_id", "report_day", "report_basis");
CREATE INDEX "booking_report_cafe_daily_event_id_report_day_report_basis_idx"
  ON "booking_report_cafe_daily"("event_id", "report_day", "report_basis");

CREATE UNIQUE INDEX "booking_report_cafe_agent_daily_cafe_id_event_id_report_day_report_basis_booked_by_agent_id_payment_mode_currency_key"
  ON "booking_report_cafe_agent_daily"("cafe_id", "event_id", "report_day", "report_basis", "booked_by_agent_id", "payment_mode", "currency");
CREATE INDEX "booking_report_cafe_agent_daily_cafe_id_report_day_report_basis_idx"
  ON "booking_report_cafe_agent_daily"("cafe_id", "report_day", "report_basis");
CREATE INDEX "booking_report_cafe_agent_daily_booked_by_agent_id_report_day_idx"
  ON "booking_report_cafe_agent_daily"("booked_by_agent_id", "report_day");

CREATE UNIQUE INDEX "booking_report_cafe_item_daily_cafe_id_event_id_report_day_report_basis_menu_item_id_currency_key"
  ON "booking_report_cafe_item_daily"("cafe_id", "event_id", "report_day", "report_basis", "menu_item_id", "currency");
CREATE INDEX "booking_report_cafe_item_daily_cafe_id_report_day_report_basis_idx"
  ON "booking_report_cafe_item_daily"("cafe_id", "report_day", "report_basis");
CREATE INDEX "booking_report_cafe_item_daily_menu_item_id_idx"
  ON "booking_report_cafe_item_daily"("menu_item_id");

ALTER TABLE "booking_report_cafe_daily"
  ADD CONSTRAINT "booking_report_cafe_daily_cafe_id_fkey"
  FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_report_cafe_daily"
  ADD CONSTRAINT "booking_report_cafe_daily_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_report_cafe_agent_daily"
  ADD CONSTRAINT "booking_report_cafe_agent_daily_cafe_id_fkey"
  FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_report_cafe_agent_daily"
  ADD CONSTRAINT "booking_report_cafe_agent_daily_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_report_cafe_item_daily"
  ADD CONSTRAINT "booking_report_cafe_item_daily_cafe_id_fkey"
  FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_report_cafe_item_daily"
  ADD CONSTRAINT "booking_report_cafe_item_daily_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hot path for cafe line attribution / recent orders fallback.
CREATE INDEX IF NOT EXISTS "order_items_ticket_is_cafe_created_at_idx"
  ON "order_items"("ticket_is_cafe", "created_at");
CREATE INDEX IF NOT EXISTS "order_items_item_type_item_id_created_at_idx"
  ON "order_items"("item_type", "item_id", "created_at");
