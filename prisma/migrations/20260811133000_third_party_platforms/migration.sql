-- CreateTable
CREATE TABLE "third_party_platforms" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "access_code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "third_party_platforms_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ticket_types"
ADD COLUMN "is_third_party_platform_ticket" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "third_party_platform_id" UUID;

-- CreateIndex
CREATE INDEX "third_party_platforms_event_id_sort_order_idx" ON "third_party_platforms"("event_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "third_party_platforms_event_id_name_key" ON "third_party_platforms"("event_id", "name");

-- CreateIndex
CREATE INDEX "ticket_types_third_party_platform_id_idx" ON "ticket_types"("third_party_platform_id");

-- AddForeignKey
ALTER TABLE "third_party_platforms" ADD CONSTRAINT "third_party_platforms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_third_party_platform_id_fkey" FOREIGN KEY ("third_party_platform_id") REFERENCES "third_party_platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
