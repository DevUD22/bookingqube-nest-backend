-- Private-event gate password + hosted checkout sessions (QPay / MyFatoorah / MPGS).

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "gate_password" TEXT;

CREATE TABLE IF NOT EXISTS "hosted_checkout_sessions" (
    "id" UUID NOT NULL,
    "sid" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "environment" "PaymentGatewayEnvironment" NOT NULL DEFAULT 'live',
    "common_order" TEXT,
    "order_id" UUID,
    "encryption_key" TEXT,
    "params_json" JSONB NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "checkout_ref" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "hosted_checkout_sessions_sid_key" ON "hosted_checkout_sessions"("sid");
CREATE INDEX IF NOT EXISTS "hosted_checkout_sessions_gateway_status_idx" ON "hosted_checkout_sessions"("gateway", "status");
CREATE INDEX IF NOT EXISTS "hosted_checkout_sessions_common_order_idx" ON "hosted_checkout_sessions"("common_order");
CREATE INDEX IF NOT EXISTS "hosted_checkout_sessions_expires_at_idx" ON "hosted_checkout_sessions"("expires_at");
