-- AlterTable
ALTER TABLE "cafe_menu_categories" ADD COLUMN "image_media_id" UUID;

-- AlterTable
ALTER TABLE "cafe_menu_subcategories" ADD COLUMN "image_media_id" UUID;
ALTER TABLE "cafe_menu_subcategories" ADD COLUMN "is_ungrouped" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "cafe_menu_categories_image_media_id_idx" ON "cafe_menu_categories"("image_media_id");

-- CreateIndex
CREATE INDEX "cafe_menu_subcategories_image_media_id_idx" ON "cafe_menu_subcategories"("image_media_id");

-- CreateIndex
CREATE INDEX "cafe_menu_subcategories_category_id_is_ungrouped_idx" ON "cafe_menu_subcategories"("category_id", "is_ungrouped");

-- AddForeignKey
ALTER TABLE "cafe_menu_categories" ADD CONSTRAINT "cafe_menu_categories_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_menu_subcategories" ADD CONSTRAINT "cafe_menu_subcategories_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
