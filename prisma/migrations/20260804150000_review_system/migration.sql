CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'published', 'rejected', 'flagged', 'archived');

ALTER TABLE "events"
  ADD COLUMN "reviews_enabled" BOOLEAN,
  ADD COLUMN "review_opens_after_minutes" INTEGER,
  ADD COLUMN "review_closes_after_days" INTEGER;

CREATE TABLE "review_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "reviews_enabled" BOOLEAN NOT NULL DEFAULT true,
  "booking_feedback_enabled" BOOLEAN NOT NULL DEFAULT true,
  "require_checked_in" BOOLEAN NOT NULL DEFAULT false,
  "auto_publish" BOOLEAN NOT NULL DEFAULT false,
  "allow_comments" BOOLEAN NOT NULL DEFAULT true,
  "show_on_event_pages" BOOLEAN NOT NULL DEFAULT true,
  "show_on_homepage_cards" BOOLEAN NOT NULL DEFAULT false,
  "minimum_review_count" INTEGER NOT NULL DEFAULT 1,
  "default_opens_after_minutes" INTEGER NOT NULL DEFAULT 0,
  "default_closes_after_days" INTEGER NOT NULL DEFAULT 60,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "review_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "review_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);

CREATE TABLE "event_reviews" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT,
  "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
  "verified_booking" BOOLEAN NOT NULL DEFAULT true,
  "verified_attendee" BOOLEAN NOT NULL DEFAULT false,
  "moderator_note" TEXT,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "event_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "event_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE TABLE "booking_feedback" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "rating" INTEGER NOT NULL,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX "event_reviews_order_id_key" ON "event_reviews"("order_id");
CREATE UNIQUE INDEX "event_reviews_event_id_customer_id_key" ON "event_reviews"("event_id", "customer_id");
CREATE INDEX "event_reviews_event_id_status_published_at_idx" ON "event_reviews"("event_id", "status", "published_at");
CREATE INDEX "event_reviews_status_created_at_idx" ON "event_reviews"("status", "created_at");
CREATE UNIQUE INDEX "booking_feedback_order_id_key" ON "booking_feedback"("order_id");
CREATE INDEX "booking_feedback_created_at_idx" ON "booking_feedback"("created_at");

ALTER TABLE "event_reviews" ADD CONSTRAINT "event_reviews_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_reviews" ADD CONSTRAINT "event_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_reviews" ADD CONSTRAINT "event_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_feedback" ADD CONSTRAINT "booking_feedback_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_feedback" ADD CONSTRAINT "booking_feedback_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description")
VALUES
  (gen_random_uuid(), 'reviews.read', 'View customer reviews and review settings'),
  (gen_random_uuid(), 'reviews.manage', 'Moderate reviews and update review settings')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE lower(r."name") IN ('super admin', 'admin')
  AND p."key" IN ('reviews.read', 'reviews.manage')
ON CONFLICT DO NOTHING;
