ALTER TABLE "customer_profiles"
  ADD COLUMN IF NOT EXISTS "age_group" TEXT,
  ADD COLUMN IF NOT EXISTS "nationality" TEXT;
