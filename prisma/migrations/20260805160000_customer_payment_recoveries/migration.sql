-- CreateEnum
CREATE TYPE "CustomerPaymentRecoveryStatus" AS ENUM ('open', 'resolved', 'abandoned');

-- CreateEnum
CREATE TYPE "CustomerPaymentRecoveryReason" AS ENUM (
  'awaiting_confirm',
  'payment_ok_booking_failed',
  'inventory_unavailable',
  'confirm_never_called'
);

-- CreateTable
CREATE TABLE "customer_payment_recoveries" (
    "id" UUID NOT NULL,
    "common_order" TEXT,
    "order_id" UUID,
    "customer_id" UUID,
    "customer_email" CITEXT,
    "event_id" UUID,
    "event_slug" TEXT,
    "gateway" "PaymentGateway" NOT NULL,
    "status" "CustomerPaymentRecoveryStatus" NOT NULL DEFAULT 'open',
    "reason" "CustomerPaymentRecoveryReason" NOT NULL DEFAULT 'awaiting_confirm',
    "amount" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "idempotency_key" TEXT,
    "provider_session_id" TEXT,
    "provider_invoice_id" TEXT,
    "provider_payment_id" TEXT,
    "checkout_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "failure_message" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_payment_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_status_created_at_idx" ON "customer_payment_recoveries"("status", "created_at");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_common_order_idx" ON "customer_payment_recoveries"("common_order");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_idempotency_key_idx" ON "customer_payment_recoveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_provider_session_id_idx" ON "customer_payment_recoveries"("provider_session_id");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_customer_email_idx" ON "customer_payment_recoveries"("customer_email");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_gateway_status_idx" ON "customer_payment_recoveries"("gateway", "status");

-- CreateIndex
CREATE INDEX "customer_payment_recoveries_order_id_idx" ON "customer_payment_recoveries"("order_id");

-- AddForeignKey
ALTER TABLE "customer_payment_recoveries" ADD CONSTRAINT "customer_payment_recoveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_recoveries" ADD CONSTRAINT "customer_payment_recoveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payment_recoveries" ADD CONSTRAINT "customer_payment_recoveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
