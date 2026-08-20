-- Allow the admin workspace to manage the homepage FAQ collection.
INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.faqs.read', 'CMS → Homepage FAQs — view homepage questions'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "key" = 'cms.faqs.read'
);

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.faqs.write', 'CMS → Homepage FAQs — create, edit, order, and publish homepage questions'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "key" = 'cms.faqs.write'
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'admin'
  AND p.key IN ('cms.faqs.read', 'cms.faqs.write')
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
