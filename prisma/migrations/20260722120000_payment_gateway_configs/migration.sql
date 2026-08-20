-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('myfatoorah', 'mastercard', 'qpay');

-- CreateEnum
CREATE TYPE "PaymentGatewayEnvironment" AS ENUM ('sandbox', 'live');

-- CreateTable
CREATE TABLE "payment_gateway_configs" (
    "id" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "environment" "PaymentGatewayEnvironment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "config_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_gateway_configs_gateway_is_active_idx" ON "payment_gateway_configs"("gateway", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_configs_gateway_environment_key" ON "payment_gateway_configs"("gateway", "environment");
