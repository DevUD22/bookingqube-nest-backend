-- Add event scope to daily closings so event filters work and agents can close per event/day.

ALTER TABLE "daily_closings" ADD COLUMN "event_id" UUID;

-- Prefer the event with the most paid bookings for that agent on the closing date.
WITH order_days AS (
  SELECT
    o.booked_by_agent_id AS agent_id,
    ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'UTC')::date) AS closing_day,
    o.event_id,
    COUNT(*)::int AS order_count
  FROM "orders" o
  WHERE o.booked_by_agent_id IS NOT NULL
    AND o.cancelled_at IS NULL
    AND o.status IN ('paid', 'refunded', 'partially_refunded')
  GROUP BY
    o.booked_by_agent_id,
    ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'UTC')::date),
    o.event_id
),
ranked AS (
  SELECT DISTINCT ON (agent_id, closing_day)
    agent_id,
    closing_day,
    event_id
  FROM order_days
  ORDER BY agent_id, closing_day, order_count DESC
)
UPDATE "daily_closings" dc
SET "event_id" = ranked.event_id
FROM ranked
WHERE dc."event_id" IS NULL
  AND dc."agent_id" = ranked.agent_id
  AND dc."closing_for_date" = ranked.closing_day;

-- Fallback: active POS staff assignment event for the agent.
UPDATE "daily_closings" dc
SET "event_id" = sa."event_id"
FROM "staff_assignments" sa
INNER JOIN "roles" r ON r."id" = sa."role_id"
WHERE dc."event_id" IS NULL
  AND sa."user_id" = dc."agent_id"
  AND sa."status" = 'active'
  AND sa."event_id" IS NOT NULL
  AND r."name" = 'pos';

-- Soft-delete any closings that still cannot be scoped to an event.
UPDATE "daily_closings"
SET "deleted_at" = COALESCE("deleted_at", NOW())
WHERE "event_id" IS NULL
  AND "deleted_at" IS NULL;

-- Remaining null rows (already soft-deleted) get a placeholder from any event on their org, else any event.
UPDATE "daily_closings" dc
SET "event_id" = (
  SELECT e."id"
  FROM "events" e
  WHERE dc."organization_id" IS NOT NULL
    AND e."organization_id" = dc."organization_id"
  ORDER BY e."created_at" ASC
  LIMIT 1
)
WHERE dc."event_id" IS NULL;

UPDATE "daily_closings" dc
SET "event_id" = (SELECT e."id" FROM "events" e ORDER BY e."created_at" ASC LIMIT 1)
WHERE dc."event_id" IS NULL;

-- If the database has zero events, closings without event_id cannot be kept.
DELETE FROM "daily_closings" WHERE "event_id" IS NULL;

ALTER TABLE "daily_closings" ALTER COLUMN "event_id" SET NOT NULL;

DROP INDEX IF EXISTS "daily_closings_agent_date_active_uidx";

CREATE UNIQUE INDEX "daily_closings_agent_event_date_active_uidx"
  ON "daily_closings"("agent_id", "event_id", "closing_for_date")
  WHERE "deleted_at" IS NULL;

CREATE INDEX "daily_closings_event_id_closing_for_date_idx"
  ON "daily_closings"("event_id", "closing_for_date");

ALTER TABLE "daily_closings"
  ADD CONSTRAINT "daily_closings_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
