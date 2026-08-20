-- Add parent/subcategory support and thumbnail for event categories
ALTER TABLE "event_categories"
  ADD COLUMN IF NOT EXISTS "parent_id" UUID,
  ADD COLUMN IF NOT EXISTS "thumbnail_url" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_categories_parent_id_fkey'
  ) THEN
    ALTER TABLE "event_categories"
      ADD CONSTRAINT "event_categories_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "event_categories"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "event_categories_parent_id_idx" ON "event_categories"("parent_id");
