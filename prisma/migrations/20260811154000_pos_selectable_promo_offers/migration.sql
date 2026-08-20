-- Optional display metadata for promotions that POS agents may select by name.
ALTER TABLE "promo_codes"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "show_in_pos" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "promo_codes_show_in_pos_status_idx"
  ON "promo_codes" ("show_in_pos", "status", "starts_at", "ends_at");
