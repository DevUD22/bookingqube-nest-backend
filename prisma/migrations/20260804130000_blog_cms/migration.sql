ALTER TABLE "blogs"
  ADD COLUMN "author_name" TEXT,
  ADD COLUMN "show_on_homepage" BOOLEAN NOT NULL DEFAULT true;

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.blogs.read', 'CMS → Blogs — view blog posts'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.blogs.read');

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.blogs.write', 'CMS → Blogs — create, edit, archive, and publish blog posts'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.blogs.write');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name = 'admin'
  AND p.key IN ('cms.blogs.read', 'cms.blogs.write')
  AND NOT EXISTS (
    SELECT 1 FROM "role_permissions" rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
