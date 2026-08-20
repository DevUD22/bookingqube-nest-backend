-- AlterTable
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "more_ops_config" JSONB;

-- AlterTable
ALTER TABLE "event_translations" ADD COLUMN IF NOT EXISTS "waiver_content" TEXT;
ALTER TABLE "event_translations" ADD COLUMN IF NOT EXISTS "inclusions_json" JSONB;
ALTER TABLE "event_translations" ADD COLUMN IF NOT EXISTS "exclusions_json" JSONB;
