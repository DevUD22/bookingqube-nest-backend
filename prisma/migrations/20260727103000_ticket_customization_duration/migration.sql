-- Timed duration support for ticket customization options
ALTER TABLE "ticket_customization_options"
  ADD COLUMN IF NOT EXISTS "has_duration" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "duration_minutes" INTEGER;
