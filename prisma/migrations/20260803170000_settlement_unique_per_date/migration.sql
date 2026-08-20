-- One settlement per calendar day (not per creator).
-- Keep the earliest settlement when duplicates already exist.

DELETE FROM "settlements" s
USING "settlements" newer
WHERE s."settlement_for_date" = newer."settlement_for_date"
  AND s."created_at" > newer."created_at";

DROP INDEX IF EXISTS "settlements_settlement_by_id_settlement_for_date_key";

CREATE UNIQUE INDEX "settlements_settlement_for_date_key" ON "settlements"("settlement_for_date");
