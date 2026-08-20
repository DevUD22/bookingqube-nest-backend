-- CreateEnum
CREATE TYPE "StaffAssignmentStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "staff_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_id" UUID,
    "venue_share_id" UUID,
    "ticket_type_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_assignments_user_id_status_idx" ON "staff_assignments"("user_id", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_organization_id_status_idx" ON "staff_assignments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_event_id_status_idx" ON "staff_assignments"("event_id", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_role_id_status_idx" ON "staff_assignments"("role_id", "status");

-- CreateIndex
CREATE INDEX "staff_assignments_venue_share_id_idx" ON "staff_assignments"("venue_share_id");

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_venue_share_id_fkey" FOREIGN KEY ("venue_share_id") REFERENCES "venue_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;
