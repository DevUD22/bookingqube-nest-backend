-- Venue fields aligned with legacy admin venue form
ALTER TABLE "venues"
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "zipcode" TEXT,
  ADD COLUMN IF NOT EXISTS "google_map_url" TEXT,
  ADD COLUMN IF NOT EXISTS "banner_url" TEXT,
  ADD COLUMN IF NOT EXISTS "gallery_urls" JSONB;

ALTER TABLE "venue_translations"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT;
