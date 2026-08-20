-- Hot path for vendor-scoped Event Insights SQL aggregates.
CREATE INDEX IF NOT EXISTS "order_items_event_id_third_party_vendor_id_idx"
  ON "order_items" ("event_id", "third_party_vendor_id");
