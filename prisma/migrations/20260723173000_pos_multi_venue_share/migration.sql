-- AlterTable users
ALTER TABLE "users" ADD COLUMN "username" CITEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AlterTable staff_assignments
ALTER TABLE "staff_assignments" ADD COLUMN "venue_share_ids" UUID[] DEFAULT ARRAY[]::UUID[];
ALTER TABLE "staff_assignments" ADD COLUMN "is_cafe_agent" BOOLEAN NOT NULL DEFAULT false;

-- Backfill venue_share_ids from single venue_share_id
UPDATE "staff_assignments"
SET "venue_share_ids" = ARRAY["venue_share_id"]
WHERE "venue_share_id" IS NOT NULL
  AND (cardinality("venue_share_ids") = 0 OR "venue_share_ids" IS NULL);
