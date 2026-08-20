CREATE TYPE "DiscountApplication" AS ENUM ('per_ticket', 'order_total');

ALTER TABLE "promo_codes"
ADD COLUMN "discount_application" "DiscountApplication" NOT NULL DEFAULT 'per_ticket';
