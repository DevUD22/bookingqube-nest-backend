-- AlterTable
ALTER TABLE "admin_profiles" ADD COLUMN "avatar_media_id" UUID;

-- AddForeignKey
ALTER TABLE "admin_profiles"
ADD CONSTRAINT "admin_profiles_avatar_media_id_fkey"
FOREIGN KEY ("avatar_media_id") REFERENCES "media_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
