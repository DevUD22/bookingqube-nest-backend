-- Time extension amount on vendor product daily rollup (with-ticket + standalone TE).
ALTER TABLE "booking_report_vendor_product_daily"
  ADD COLUMN IF NOT EXISTS "time_extension_amount" DECIMAL(14, 3) NOT NULL DEFAULT 0;
