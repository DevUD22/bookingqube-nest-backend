-- CreateTable
CREATE TABLE IF NOT EXISTS "footer_menu_items" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "description_en" TEXT,
    "description_ar" TEXT,
    "body_html_en" TEXT,
    "body_html_ar" TEXT,
    "slug" TEXT,
    "url" TEXT,
    "target" TEXT NOT NULL DEFAULT '_self',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "footer_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "footer_menu_items_slug_key" ON "footer_menu_items"("slug");
CREATE INDEX IF NOT EXISTS "footer_menu_items_parent_id_sort_order_idx" ON "footer_menu_items"("parent_id", "sort_order");
CREATE INDEX IF NOT EXISTS "footer_menu_items_status_sort_order_idx" ON "footer_menu_items"("status", "sort_order");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "footer_menu_items" ADD CONSTRAINT "footer_menu_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "footer_menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
