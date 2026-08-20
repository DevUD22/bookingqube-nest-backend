ALTER TABLE "promo_codes" ADD COLUMN "organization_id" UUID;
ALTER TABLE "promo_codes" ADD COLUMN "created_by_user_id" UUID;
ALTER TABLE "promo_codes" ADD COLUMN "updated_by_user_id" UUID;

UPDATE "promo_codes" AS promo
SET "organization_id" = event."organization_id"
FROM "promo_code_targets" AS target
JOIN "events" AS event ON event."id" = target."target_id"
WHERE target."promo_code_id" = promo."id"
  AND target."target_type" = 'event'
  AND promo."organization_id" IS NULL;

UPDATE "promo_codes" AS promo
SET "organization_id" = event."organization_id"
FROM "promo_code_targets" AS target
JOIN "ticket_types" AS ticket ON ticket."id" = target."target_id"
JOIN "events" AS event ON event."id" = ticket."event_id"
WHERE target."promo_code_id" = promo."id"
  AND target."target_type" = 'ticket_type'
  AND promo."organization_id" IS NULL;

UPDATE "promo_codes" AS promo
SET "organization_id" = event."organization_id"
FROM "promo_code_targets" AS target
JOIN "ticket_variants" AS variant ON variant."id" = target."target_id"
JOIN "ticket_types" AS ticket ON ticket."id" = variant."ticket_type_id"
JOIN "events" AS event ON event."id" = ticket."event_id"
WHERE target."promo_code_id" = promo."id"
  AND target."target_type" = 'ticket_variant'
  AND promo."organization_id" IS NULL;

UPDATE "promo_codes"
SET "organization_id" = (
  SELECT "id" FROM "organizations" ORDER BY CASE WHEN "slug" = 'bookingqube' THEN 0 ELSE 1 END, "created_at" LIMIT 1
)
WHERE "organization_id" IS NULL;

ALTER TABLE "promo_codes" ALTER COLUMN "organization_id" SET NOT NULL;
DROP INDEX IF EXISTS "promo_codes_status_starts_at_ends_at_idx";
CREATE INDEX "promo_codes_organization_id_status_starts_at_ends_at_idx"
  ON "promo_codes"("organization_id", "status", "starts_at", "ends_at");

ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
