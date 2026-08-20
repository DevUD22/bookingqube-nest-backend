-- CreateTable
CREATE TABLE "cafes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT,
    "table_count" INTEGER NOT NULL DEFAULT 1,
    "manager_user_id" UUID,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "active_event_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_event_assignments" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "assigned_by_user_id" UUID,

    CONSTRAINT "cafe_event_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_menu_categories" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_menu_subcategories" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_menu_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_menu_items" (
    "id" UUID NOT NULL,
    "subcategory_id" UUID NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT,
    "description" TEXT,
    "price" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "image_media_id" UUID,
    "is_kot" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cafe_pos_agents" (
    "id" UUID NOT NULL,
    "cafe_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "StaffAssignmentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cafe_pos_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cafes_organization_id_status_idx" ON "cafes"("organization_id", "status");

-- CreateIndex
CREATE INDEX "cafes_active_event_id_idx" ON "cafes"("active_event_id");

-- CreateIndex
CREATE INDEX "cafes_manager_user_id_idx" ON "cafes"("manager_user_id");

-- CreateIndex
CREATE INDEX "cafe_event_assignments_cafe_id_unassigned_at_idx" ON "cafe_event_assignments"("cafe_id", "unassigned_at");

-- CreateIndex
CREATE INDEX "cafe_event_assignments_event_id_idx" ON "cafe_event_assignments"("event_id");

-- CreateIndex
CREATE INDEX "cafe_event_assignments_assigned_by_user_id_idx" ON "cafe_event_assignments"("assigned_by_user_id");

-- CreateIndex
CREATE INDEX "cafe_menu_categories_cafe_id_sort_order_idx" ON "cafe_menu_categories"("cafe_id", "sort_order");

-- CreateIndex
CREATE INDEX "cafe_menu_categories_cafe_id_status_idx" ON "cafe_menu_categories"("cafe_id", "status");

-- CreateIndex
CREATE INDEX "cafe_menu_subcategories_category_id_sort_order_idx" ON "cafe_menu_subcategories"("category_id", "sort_order");

-- CreateIndex
CREATE INDEX "cafe_menu_subcategories_category_id_status_idx" ON "cafe_menu_subcategories"("category_id", "status");

-- CreateIndex
CREATE INDEX "cafe_menu_items_subcategory_id_sort_order_idx" ON "cafe_menu_items"("subcategory_id", "sort_order");

-- CreateIndex
CREATE INDEX "cafe_menu_items_subcategory_id_status_idx" ON "cafe_menu_items"("subcategory_id", "status");

-- CreateIndex
CREATE INDEX "cafe_menu_items_image_media_id_idx" ON "cafe_menu_items"("image_media_id");

-- CreateIndex
CREATE UNIQUE INDEX "cafe_pos_agents_cafe_id_user_id_key" ON "cafe_pos_agents"("cafe_id", "user_id");

-- CreateIndex
CREATE INDEX "cafe_pos_agents_user_id_status_idx" ON "cafe_pos_agents"("user_id", "status");

-- CreateIndex
CREATE INDEX "cafe_pos_agents_cafe_id_status_idx" ON "cafe_pos_agents"("cafe_id", "status");

-- AddForeignKey
ALTER TABLE "cafes" ADD CONSTRAINT "cafes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafes" ADD CONSTRAINT "cafes_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafes" ADD CONSTRAINT "cafes_active_event_id_fkey" FOREIGN KEY ("active_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_event_assignments" ADD CONSTRAINT "cafe_event_assignments_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_event_assignments" ADD CONSTRAINT "cafe_event_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_event_assignments" ADD CONSTRAINT "cafe_event_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_menu_categories" ADD CONSTRAINT "cafe_menu_categories_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_menu_subcategories" ADD CONSTRAINT "cafe_menu_subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "cafe_menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_menu_items" ADD CONSTRAINT "cafe_menu_items_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "cafe_menu_subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_menu_items" ADD CONSTRAINT "cafe_menu_items_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_pos_agents" ADD CONSTRAINT "cafe_pos_agents_cafe_id_fkey" FOREIGN KEY ("cafe_id") REFERENCES "cafes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cafe_pos_agents" ADD CONSTRAINT "cafe_pos_agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
