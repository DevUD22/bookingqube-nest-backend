-- AlterTable
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "banner_media_id" UUID;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artists_banner_media_id_fkey'
  ) THEN
    ALTER TABLE "artists"
      ADD CONSTRAINT "artists_banner_media_id_fkey"
      FOREIGN KEY ("banner_media_id") REFERENCES "media_assets"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
