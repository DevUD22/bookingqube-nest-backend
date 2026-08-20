-- Rename VenueShare to ThirdPartyVendor (tables, columns, indexes, FKs)

-- 1) Main table
ALTER TABLE "venue_shares" RENAME TO "third_party_vendors";
ALTER TABLE "third_party_vendors" RENAME COLUMN "venue_share_pct" TO "vendor_share_pct";

ALTER INDEX IF EXISTS "venue_shares_pkey" RENAME TO "third_party_vendors_pkey";
ALTER INDEX IF EXISTS "venue_shares_event_id_sort_order_idx" RENAME TO "third_party_vendors_event_id_sort_order_idx";
ALTER INDEX IF EXISTS "venue_shares_event_id_name_key" RENAME TO "third_party_vendors_event_id_name_key";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venue_shares_pkey'
  ) THEN
    ALTER TABLE "third_party_vendors" RENAME CONSTRAINT "venue_shares_pkey" TO "third_party_vendors_pkey";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venue_shares_event_id_fkey'
  ) THEN
    ALTER TABLE "third_party_vendors" RENAME CONSTRAINT "venue_shares_event_id_fkey" TO "third_party_vendors_event_id_fkey";
  END IF;
END $$;

-- 2) ticket_types
ALTER TABLE "ticket_types" RENAME COLUMN "venue_share_id" TO "third_party_vendor_id";
ALTER INDEX IF EXISTS "ticket_types_venue_share_id_idx" RENAME TO "ticket_types_third_party_vendor_id_idx";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ticket_types_venue_share_id_fkey'
  ) THEN
    ALTER TABLE "ticket_types" RENAME CONSTRAINT "ticket_types_venue_share_id_fkey" TO "ticket_types_third_party_vendor_id_fkey";
  END IF;
END $$;

-- 3) order_items
ALTER TABLE "order_items" RENAME COLUMN "venue_share_id" TO "third_party_vendor_id";
ALTER INDEX IF EXISTS "order_items_venue_share_id_idx" RENAME TO "order_items_third_party_vendor_id_idx";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_venue_share_id_fkey'
  ) THEN
    ALTER TABLE "order_items" RENAME CONSTRAINT "order_items_venue_share_id_fkey" TO "order_items_third_party_vendor_id_fkey";
  END IF;
END $$;

-- 4) staff_assignments
ALTER TABLE "staff_assignments" RENAME COLUMN "venue_share_id" TO "third_party_vendor_id";
ALTER TABLE "staff_assignments" RENAME COLUMN "venue_share_ids" TO "third_party_vendor_ids";
ALTER INDEX IF EXISTS "staff_assignments_venue_share_id_idx" RENAME TO "staff_assignments_third_party_vendor_id_idx";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_assignments_venue_share_id_fkey'
  ) THEN
    ALTER TABLE "staff_assignments" RENAME CONSTRAINT "staff_assignments_venue_share_id_fkey" TO "staff_assignments_third_party_vendor_id_fkey";
  END IF;
END $$;

-- 5) booking_report_venue_share_daily -> booking_report_third_party_vendor_daily
ALTER TABLE "booking_report_venue_share_daily" RENAME TO "booking_report_third_party_vendor_daily";
ALTER TABLE "booking_report_third_party_vendor_daily" RENAME COLUMN "venue_share_id" TO "third_party_vendor_id";

ALTER INDEX IF EXISTS "booking_report_venue_share_daily_pkey" RENAME TO "booking_report_third_party_vendor_daily_pkey";
ALTER INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_report_basis_venue_share_id_currency_key"
  RENAME TO "booking_report_third_party_vendor_daily_event_id_report_day_report_basis_third_party_vendor_id_currency_key";
ALTER INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_report_basis_idx"
  RENAME TO "booking_report_third_party_vendor_daily_event_id_report_day_report_basis_idx";
ALTER INDEX IF EXISTS "booking_report_venue_share_daily_venue_share_id_report_day_idx"
  RENAME TO "booking_report_third_party_vendor_daily_third_party_vendor_id_report_day_idx";
ALTER INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_venue_share_id_currency_key"
  RENAME TO "booking_report_third_party_vendor_daily_event_id_report_day_third_party_vendor_id_currency_key";
ALTER INDEX IF EXISTS "booking_report_venue_share_daily_event_id_report_day_idx"
  RENAME TO "booking_report_third_party_vendor_daily_event_id_report_day_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_report_venue_share_daily_pkey'
  ) THEN
    ALTER TABLE "booking_report_third_party_vendor_daily"
      RENAME CONSTRAINT "booking_report_venue_share_daily_pkey" TO "booking_report_third_party_vendor_daily_pkey";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_report_venue_share_daily_event_id_fkey'
  ) THEN
    ALTER TABLE "booking_report_third_party_vendor_daily"
      RENAME CONSTRAINT "booking_report_venue_share_daily_event_id_fkey" TO "booking_report_third_party_vendor_daily_event_id_fkey";
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_report_venue_share_daily_venue_share_id_fkey'
  ) THEN
    ALTER TABLE "booking_report_third_party_vendor_daily"
      RENAME CONSTRAINT "booking_report_venue_share_daily_venue_share_id_fkey" TO "booking_report_third_party_vendor_daily_third_party_vendor_id_fkey";
  END IF;
END $$;
