-- AlterEnum
ALTER TYPE "PromoTargetType" ADD VALUE 'cafe';
ALTER TYPE "PromoTargetType" ADD VALUE 'cafe_menu_item';

-- AlterTable
ALTER TABLE "cafe_orders" ADD COLUMN "discount_amount" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "cafe_orders" ADD COLUMN "promo_code_id" UUID;
ALTER TABLE "cafe_orders" ADD COLUMN "promo_code" TEXT;

-- CreateIndex
CREATE INDEX "cafe_orders_promo_code_id_idx" ON "cafe_orders"("promo_code_id");

-- AddForeignKey
ALTER TABLE "cafe_orders"
  ADD CONSTRAINT "cafe_orders_promo_code_id_fkey"
  FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
