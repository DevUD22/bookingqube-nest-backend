-- AlterTable
ALTER TABLE "events" ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "events_is_featured_status_starts_at_idx" ON "events"("is_featured", "status", "starts_at");
