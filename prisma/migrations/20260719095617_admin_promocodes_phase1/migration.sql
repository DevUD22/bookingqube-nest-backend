-- AlterTable
ALTER TABLE "organization_members" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "organizations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "organizer_sessions_organization_member_id_revoked_at_expires_at" RENAME TO "organizer_sessions_organization_member_id_revoked_at_expire_idx";
