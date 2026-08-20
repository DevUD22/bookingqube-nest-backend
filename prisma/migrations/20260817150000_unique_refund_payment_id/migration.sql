-- One pending or succeeded refund per payment (blocks concurrent POS double-refunds).
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_open_or_succeeded_payment_id_unique"
ON "refunds" ("payment_id")
WHERE "status" IN ('pending', 'succeeded');
