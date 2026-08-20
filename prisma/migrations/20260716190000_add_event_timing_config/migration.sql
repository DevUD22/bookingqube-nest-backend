-- AlterTable
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "timing_config" JSONB;
