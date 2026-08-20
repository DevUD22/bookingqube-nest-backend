-- CreateTable
CREATE TABLE "cafe_menu_item_variants" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "price" DECIMAL(12,3) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_menu_item_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cafe_menu_item_variants_item_id_sort_order_idx" ON "cafe_menu_item_variants"("item_id", "sort_order");

-- CreateIndex
CREATE INDEX "cafe_menu_item_variants_item_id_status_idx" ON "cafe_menu_item_variants"("item_id", "status");

-- AddForeignKey
ALTER TABLE "cafe_menu_item_variants" ADD CONSTRAINT "cafe_menu_item_variants_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "cafe_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
