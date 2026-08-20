-- CreateTable
CREATE TABLE "venue_shares" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "organiser_share" DECIMAL(5,2) NOT NULL,
    "venue_share_pct" DECIMAL(5,2) NOT NULL,
    "is_cafe" BOOLEAN NOT NULL DEFAULT false,
    "collected_by" TEXT,
    "owner_name" TEXT,
    "owner_percentage_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_shares_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN "venue_share_id" UUID;

-- CreateIndex
CREATE INDEX "venue_shares_event_id_sort_order_idx" ON "venue_shares"("event_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "venue_shares_event_id_name_key" ON "venue_shares"("event_id", "name");

-- CreateIndex
CREATE INDEX "ticket_types_venue_share_id_idx" ON "ticket_types"("venue_share_id");

-- AddForeignKey
ALTER TABLE "venue_shares" ADD CONSTRAINT "venue_shares_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_venue_share_id_fkey" FOREIGN KEY ("venue_share_id") REFERENCES "venue_shares"("id") ON DELETE SET NULL ON UPDATE CASCADE;
