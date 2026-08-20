ALTER TABLE "ticket_types"
ADD COLUMN "sales_start_at" TIMESTAMP(3),
ADD COLUMN "sales_end_at" TIMESTAMP(3);

CREATE INDEX "ticket_types_event_id_sales_start_at_sales_end_at_idx"
ON "ticket_types"("event_id", "sales_start_at", "sales_end_at");
