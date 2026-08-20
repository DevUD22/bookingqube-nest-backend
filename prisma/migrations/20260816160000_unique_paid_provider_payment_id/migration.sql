-- One captured gateway payment id can settle exactly one paid order.
CREATE UNIQUE INDEX IF NOT EXISTS "payments_paid_provider_payment_id_unique"
ON "payments" ("provider", "provider_payment_id")
WHERE "provider_payment_id" IS NOT NULL
  AND "provider_payment_id" <> ''
  AND "status" = 'paid';
