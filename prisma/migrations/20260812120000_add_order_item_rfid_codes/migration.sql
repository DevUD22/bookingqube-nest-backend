ALTER TABLE "order_items"
ADD COLUMN "rfid_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "order_items_rfid_codes_idx"
ON "order_items" USING GIN ("rfid_codes");
