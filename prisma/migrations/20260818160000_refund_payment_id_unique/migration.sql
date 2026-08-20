-- One refund row per payment. Replaces the non-unique payment_id index and the
-- earlier partial unique (pending/succeeded only).
DROP INDEX IF EXISTS "refunds_payment_id_idx";
DROP INDEX IF EXISTS "refunds_open_or_succeeded_payment_id_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_payment_id_key" ON "refunds"("payment_id");
