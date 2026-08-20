-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('active', 'expired', 'released', 'converted');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'paid', 'cancelled', 'expired', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('not_required', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('internal', 'myfatoorah');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('ticket_type', 'ticket_variant', 'addon', 'addon_variant', 'customization');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('not_checked_in', 'checked_in', 'cancelled');

-- CreateEnum
CREATE TYPE "PromoCodeStatus" AS ENUM ('draft', 'active', 'paused', 'expired');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "PromoTargetType" AS ENUM ('event', 'ticket_type', 'ticket_variant', 'customer');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "TaxApplicableOn" AS ENUM ('net_price', 'net_price_with_addons');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('exclusive', 'inclusive');

-- CreateEnum
CREATE TYPE "TaxStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "RegistrationFieldType" AS ENUM ('text', 'email', 'phone', 'select', 'checkbox', 'file', 'textarea', 'number', 'date');

-- CreateEnum
CREATE TYPE "RegistrationSubmissionStatus" AS ENUM ('submitted', 'cancelled');

-- CreateTable
CREATE TABLE "ticket_holds" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_session_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_hold_items" (
    "id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "item_type" "InventoryItemType" NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "seats_io_object_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_hold_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "method_key" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_method_id" INTEGER,
    "title" TEXT NOT NULL,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "settings_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "common_order" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_session_id" UUID NOT NULL,
    "hold_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "subtotal_amount" DECIMAL(12,3) NOT NULL,
    "discount_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,3) NOT NULL,
    "promo_code_id" UUID,
    "promo_code" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "waiver_accepted" BOOLEAN NOT NULL DEFAULT false,
    "waiver_signed_by" TEXT,
    "waiver_accepted_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_session_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "item_type" "OrderItemType" NOT NULL,
    "item_id" UUID NOT NULL,
    "parent_order_item_id" UUID,
    "display_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,3) NOT NULL,
    "subtotal_amount" DECIMAL(12,3) NOT NULL,
    "discount_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "ticket_code" TEXT,
    "qr_code_payload" TEXT,
    "attendance_status" "AttendanceStatus" NOT NULL DEFAULT 'not_checked_in',
    "checked_in_at" TIMESTAMP(3),
    "checked_in_by_user_id" UUID,
    "seats_io_object_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'myfatoorah',
    "provider_payment_method_id" INTEGER,
    "method_key" TEXT NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "provider_invoice_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_session_id" TEXT,
    "provider_response" JSONB,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "reason" TEXT,
    "provider_refund_id" TEXT,
    "provider_response" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "status" "PromoCodeStatus" NOT NULL DEFAULT 'draft',
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(12,3) NOT NULL,
    "currency" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "max_redemptions_per_customer" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_targets" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "target_type" "PromoTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "discount_amount" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxes" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "title" TEXT NOT NULL,
    "rate_type" "RateType" NOT NULL,
    "rate" DECIMAL(12,3) NOT NULL,
    "applicable_on" "TaxApplicableOn" NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "status" "TaxStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tax_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "tax_id" UUID,
    "title" TEXT NOT NULL,
    "rate_type" "RateType" NOT NULL,
    "rate" DECIMAL(12,3) NOT NULL,
    "tax_type" "TaxType" NOT NULL,
    "taxable_amount" DECIMAL(12,3) NOT NULL,
    "tax_amount" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_tax_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_forms" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "registration_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_form_fields" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "RegistrationFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options_json" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "registration_form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_submissions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "order_id" UUID,
    "status" "RegistrationSubmissionStatus" NOT NULL DEFAULT 'submitted',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "registration_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_submission_values" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value_text" TEXT,
    "value_json" JSONB,
    "media_asset_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_submission_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_holds_idempotency_key_key" ON "ticket_holds"("idempotency_key");

-- CreateIndex
CREATE INDEX "ticket_holds_customer_id_created_at_idx" ON "ticket_holds"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_holds_status_expires_at_idx" ON "ticket_holds"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ticket_holds_event_session_id_status_idx" ON "ticket_holds"("event_session_id", "status");

-- CreateIndex
CREATE INDEX "ticket_hold_items_hold_id_idx" ON "ticket_hold_items"("hold_id");

-- CreateIndex
CREATE INDEX "ticket_hold_items_inventory_item_id_idx" ON "ticket_hold_items"("inventory_item_id");

-- CreateIndex
CREATE INDEX "ticket_hold_items_seats_io_object_id_idx" ON "ticket_hold_items"("seats_io_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_method_key_key" ON "payment_methods"("method_key");

-- CreateIndex
CREATE INDEX "payment_methods_status_sort_order_idx" ON "payment_methods"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "orders_common_order_key" ON "orders"("common_order");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_event_id_created_at_idx" ON "orders"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_event_session_id_created_at_idx" ON "orders"("event_session_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_payment_status_created_at_idx" ON "orders"("payment_status", "created_at");

-- CreateIndex
CREATE INDEX "orders_common_order_idx" ON "orders"("common_order");

-- CreateIndex
CREATE INDEX "orders_idempotency_key_idx" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_paid_at_idx" ON "orders"("paid_at");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_event_id_event_session_id_idx" ON "order_items"("event_id", "event_session_id");

-- CreateIndex
CREATE INDEX "order_items_ticket_code_idx" ON "order_items"("ticket_code");

-- CreateIndex
CREATE INDEX "order_items_attendance_status_checked_in_at_idx" ON "order_items"("attendance_status", "checked_in_at");

-- CreateIndex
CREATE INDEX "order_items_seats_io_object_id_idx" ON "order_items"("seats_io_object_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_provider_provider_payment_id_idx" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_provider_provider_invoice_id_idx" ON "payments"("provider", "provider_invoice_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_status_starts_at_ends_at_idx" ON "promo_codes"("status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "promo_code_targets_promo_code_id_idx" ON "promo_code_targets"("promo_code_id");

-- CreateIndex
CREATE INDEX "promo_code_targets_target_type_target_id_idx" ON "promo_code_targets"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_customer_id_created_at_idx" ON "promo_code_redemptions"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_redemptions_promo_code_id_order_id_key" ON "promo_code_redemptions"("promo_code_id", "order_id");

-- CreateIndex
CREATE INDEX "taxes_event_id_status_idx" ON "taxes"("event_id", "status");

-- CreateIndex
CREATE INDEX "order_tax_lines_order_id_idx" ON "order_tax_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_tax_lines_tax_id_idx" ON "order_tax_lines"("tax_id");

-- CreateIndex
CREATE INDEX "registration_forms_event_id_status_idx" ON "registration_forms"("event_id", "status");

-- CreateIndex
CREATE INDEX "registration_form_fields_form_id_sort_order_idx" ON "registration_form_fields"("form_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "registration_form_fields_form_id_field_key_key" ON "registration_form_fields"("form_id", "field_key");

-- CreateIndex
CREATE INDEX "registration_submissions_form_id_submitted_at_idx" ON "registration_submissions"("form_id", "submitted_at");

-- CreateIndex
CREATE INDEX "registration_submissions_event_id_submitted_at_idx" ON "registration_submissions"("event_id", "submitted_at");

-- CreateIndex
CREATE INDEX "registration_submissions_customer_id_submitted_at_idx" ON "registration_submissions"("customer_id", "submitted_at");

-- CreateIndex
CREATE INDEX "registration_submissions_order_id_idx" ON "registration_submissions"("order_id");

-- CreateIndex
CREATE INDEX "registration_submission_values_submission_id_idx" ON "registration_submission_values"("submission_id");

-- CreateIndex
CREATE INDEX "registration_submission_values_field_id_idx" ON "registration_submission_values"("field_id");

-- CreateIndex
CREATE INDEX "registration_submission_values_media_asset_id_idx" ON "registration_submission_values"("media_asset_id");

-- AddForeignKey
ALTER TABLE "ticket_holds" ADD CONSTRAINT "ticket_holds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_holds" ADD CONSTRAINT "ticket_holds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_holds" ADD CONSTRAINT "ticket_holds_event_session_id_fkey" FOREIGN KEY ("event_session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_hold_items" ADD CONSTRAINT "ticket_hold_items_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "ticket_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_hold_items" ADD CONSTRAINT "ticket_hold_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_session_id_fkey" FOREIGN KEY ("event_session_id") REFERENCES "event_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "ticket_holds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_event_session_id_fkey" FOREIGN KEY ("event_session_id") REFERENCES "event_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parent_order_item_id_fkey" FOREIGN KEY ("parent_order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_checked_in_by_user_id_fkey" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_targets" ADD CONSTRAINT "promo_code_targets_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxes" ADD CONSTRAINT "taxes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tax_lines" ADD CONSTRAINT "order_tax_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tax_lines" ADD CONSTRAINT "order_tax_lines_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_forms" ADD CONSTRAINT "registration_forms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_form_fields" ADD CONSTRAINT "registration_form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "registration_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "registration_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submissions" ADD CONSTRAINT "registration_submissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submission_values" ADD CONSTRAINT "registration_submission_values_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "registration_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submission_values" ADD CONSTRAINT "registration_submission_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "registration_form_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_submission_values" ADD CONSTRAINT "registration_submission_values_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
