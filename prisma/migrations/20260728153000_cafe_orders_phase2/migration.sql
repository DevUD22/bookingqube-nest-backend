-- AlterEnum
ALTER TYPE "OrderItemType" ADD VALUE 'cafe_item';

-- CreateTable
CREATE TABLE "cafe_orders" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "agent_user_id" UUID NOT NULL,
    "table_number" INTEGER NOT NULL,
    "token_no" INTEGER,
    "payment_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lines_json" JSONB NOT NULL,
    "customer_name" TEXT,
    "customer_email" TEXT,
    "order_total" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "common_order" TEXT,
    "settled_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cafe_orders_cafe_id_event_id_status_table_number_idx" ON "cafe_orders"("cafe_id", "event_id", "status", "table_number");

-- CreateIndex
CREATE INDEX "cafe_orders_agent_user_id_status_idx" ON "cafe_orders"("agent_user_id", "status");

-- CreateIndex
CREATE INDEX "cafe_orders_event_id_status_idx" ON "cafe_orders"("event_id", "status");

-- AddForeignKey
ALTER TABLE "cafe_orders" ADD CONSTRAINT "cafe_orders_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_orders" ADD CONSTRAINT "cafe_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_orders" ADD CONSTRAINT "cafe_orders_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
