-- CreateTable
CREATE TABLE "redis_settings" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redis_settings_pkey" PRIMARY KEY ("id")
);

-- Seed settings.redis.manage permission for admin + finance-manager
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'settings.redis.manage', 'Settings → Redis'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "key" = 'settings.redis.manage'
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('admin', 'finance-manager')
  AND p.key = 'settings.redis.manage'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
