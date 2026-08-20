-- Seed settings.storage.manage permission for admin + finance-manager
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'settings.storage.manage', 'Settings → File storage (Azure Blob)'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "key" = 'settings.storage.manage'
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('admin', 'finance-manager')
  AND p.key = 'settings.storage.manage'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
