-- CreateTable
CREATE TABLE "event_sales_counters" (
    "id" UUID NOT NULL,
    "scope_key" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_session_id" UUID,
    "inventory_item_id" UUID,
    "sold_qty" INTEGER NOT NULL DEFAULT 0,
    "held_qty" INTEGER NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "revenue_paid" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_sales_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_report_daily" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "report_day" DATE NOT NULL,
    "payment_mode" TEXT NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "admit_count" INTEGER NOT NULL DEFAULT 0,
    "revenue_total" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_report_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_sales_counters_scope_key_key" ON "event_sales_counters"("scope_key");

-- CreateIndex
CREATE INDEX "event_sales_counters_event_id_event_session_id_idx" ON "event_sales_counters"("event_id", "event_session_id");

-- CreateIndex
CREATE INDEX "event_sales_counters_inventory_item_id_idx" ON "event_sales_counters"("inventory_item_id");

-- CreateIndex
CREATE INDEX "booking_report_daily_event_id_report_day_idx" ON "booking_report_daily"("event_id", "report_day");

-- CreateIndex
CREATE INDEX "booking_report_daily_report_day_idx" ON "booking_report_daily"("report_day");

-- CreateIndex
CREATE UNIQUE INDEX "booking_report_daily_event_id_report_day_payment_mode_curren_key" ON "booking_report_daily"("event_id", "report_day", "payment_mode", "currency");

-- AddForeignKey
ALTER TABLE "event_sales_counters" ADD CONSTRAINT "event_sales_counters_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_report_daily" ADD CONSTRAINT "booking_report_daily_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
