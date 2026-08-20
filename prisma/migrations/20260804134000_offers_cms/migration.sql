ALTER TABLE "offers"
  ADD COLUMN "show_on_homepage" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "offer_translations"
  ADD COLUMN "meta_title" TEXT,
  ADD COLUMN "meta_description" TEXT;

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.offers.read', 'CMS → Offers & Promotions — view offers'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.offers.read');

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid(), 'cms.offers.write', 'CMS → Offers & Promotions — create, edit, archive, and publish offers'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'cms.offers.write');

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.name = 'admin' AND p.key IN ('cms.offers.read', 'cms.offers.write')
AND NOT EXISTS (
  SELECT 1 FROM "role_permissions" rp
  WHERE rp.role_id = r.id AND rp.permission_id = p.id
);
