DELETE FROM "role_permissions"
WHERE "permission_id" IN (
  SELECT "id" FROM "permissions"
  WHERE "key" IN ('cms.pages.read', 'cms.pages.write')
);

DELETE FROM "permissions"
WHERE "key" IN ('cms.pages.read', 'cms.pages.write');

DROP TABLE IF EXISTS "cms_pages";
