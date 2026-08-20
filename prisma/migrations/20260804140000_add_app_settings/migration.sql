-- CreateEnum
CREATE TYPE "AppSettingGroup" AS ENUM ('website', 'social', 'mail', 'regional');

-- CreateTable
CREATE TABLE "app_settings" (
    "id" UUID NOT NULL,
    "group" "AppSettingGroup" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config_json" JSONB NOT NULL,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_group_key" ON "app_settings"("group");

-- Seed settings.general.manage permission for admin
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'settings.general.manage', 'Settings → Website, social, mail & regional'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "key" = 'settings.general.manage'
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('admin')
  AND p.key = 'settings.general.manage'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
