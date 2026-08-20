ALTER TABLE "events"
  ADD COLUMN "primary_organizer_id" UUID,
  ADD COLUMN "organizer_assigned_by_user_id" UUID,
  ADD COLUMN "organizer_assigned_at" TIMESTAMP(3);

ALTER TABLE "events"
  ADD CONSTRAINT "events_primary_organizer_id_fkey"
  FOREIGN KEY ("primary_organizer_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "events"
  ADD CONSTRAINT "events_organizer_assigned_by_user_id_fkey"
  FOREIGN KEY ("organizer_assigned_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_primary_organizer_id_status_starts_at_idx"
  ON "events"("primary_organizer_id", "status", "starts_at");

-- Preserve valid legacy relationships only when the event creator is also an
-- active member of the event's organization. Platform-created events remain
-- intentionally unassigned until BookingQube selects an organiser.
UPDATE "events" AS event
SET
  "primary_organizer_id" = event."created_by_user_id",
  "organizer_assigned_by_user_id" = event."created_by_user_id",
  "organizer_assigned_at" = COALESCE(event."updated_at", event."created_at")
WHERE event."created_by_user_id" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "organization_members" AS member
    WHERE member."organization_id" = event."organization_id"
      AND member."user_id" = event."created_by_user_id"
      AND member."status" = 'active'
  );
