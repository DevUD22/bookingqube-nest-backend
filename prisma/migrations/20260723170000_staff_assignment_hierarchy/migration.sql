-- AlterTable
ALTER TABLE "staff_assignments" ADD COLUMN "managed_by_user_id" UUID;
ALTER TABLE "staff_assignments" ADD COLUMN "created_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "staff_assignments_managed_by_user_id_status_idx" ON "staff_assignments"("managed_by_user_id", "status");

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_managed_by_user_id_fkey" FOREIGN KEY ("managed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
