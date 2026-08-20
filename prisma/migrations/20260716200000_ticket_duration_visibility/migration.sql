-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN "has_duration" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ticket_types" ADD COLUMN "duration_minutes" INTEGER;
ALTER TABLE "ticket_types" ADD COLUMN "hide_from_online" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ticket_types" ADD COLUMN "hide_from_pos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ticket_variants" ADD COLUMN "duration_minutes" INTEGER;
