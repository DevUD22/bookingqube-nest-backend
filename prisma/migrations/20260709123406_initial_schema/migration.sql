-- EnableExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'review', 'published', 'archived');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('public', 'private', 'unlisted');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('registration_only', 'summer_camp', 'general');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('ticketed', 'registration');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'sold_out', 'cancelled', 'hidden');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('active', 'hidden', 'archived');

-- CreateEnum
CREATE TYPE "InventoryItemType" AS ENUM ('ticket_type', 'ticket_variant', 'addon', 'addon_variant');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('active', 'paused', 'sold_out');

-- CreateEnum
CREATE TYPE "DateStatus" AS ENUM ('active', 'cancelled', 'hidden');

-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('hero', 'gallery', 'thumbnail');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('azure_blob', 's3');

-- CreateTable
CREATE TABLE "health_checks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "avatar_media_id" UUID,
    "address" TEXT,
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_favorites" (
    "customer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("customer_id","event_id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "AdminStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "storage_provider" "StorageProvider" NOT NULL,
    "bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "alt_text" TEXT,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'QA',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "hero_media_id" UUID,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_translations" (
    "id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,

    CONSTRAINT "venue_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "profile_media_id" UUID,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artist_translations" (
    "id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "bio" TEXT,

    CONSTRAINT "artist_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_category_translations" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "event_category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "visibility" "Visibility" NOT NULL DEFAULT 'public',
    "venue_id" UUID,
    "primary_media_id" UUID,
    "category_id" UUID,
    "requires_waiver" BOOLEAN NOT NULL DEFAULT false,
    "booking_mode" "BookingMode" NOT NULL,
    "seat_selection_enabled" BOOLEAN NOT NULL DEFAULT false,
    "seats_io_event_key" TEXT,
    "seats_io_chart_key" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_translations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "terms_content" TEXT,
    "faq_json" JSONB,
    "meta_title" TEXT,
    "meta_description" TEXT,

    CONSTRAINT "event_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_artists" (
    "event_id" UUID NOT NULL,
    "artist_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_artists_pkey" PRIMARY KEY ("event_id","artist_id")
);

-- CreateTable
CREATE TABLE "event_media" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "media_role" "MediaRole" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_dates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "DateStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_sessions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_date_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "display_time" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "capacity" INTEGER,
    "seats_io_event_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_groups" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "icon_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_types" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_group_id" UUID,
    "external_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "icon_type" TEXT,
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "is_customizable" BOOLEAN NOT NULL DEFAULT false,
    "base_price" DECIMAL(12,3),
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "admit_count" INTEGER NOT NULL DEFAULT 1,
    "max_qty_per_order" INTEGER,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_variants" (
    "id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "badge" TEXT,
    "max_qty_per_order" INTEGER,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_customization_options" (
    "id" UUID NOT NULL,
    "ticket_type_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "max_qty_per_ticket" INTEGER,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_customization_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "icon_type" TEXT,
    "has_variants" BOOLEAN NOT NULL DEFAULT false,
    "base_price" DECIMAL(12,3),
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "max_qty_per_order" INTEGER,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_variants" (
    "id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "external_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(12,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'QAR',
    "badge" TEXT,
    "max_qty_per_order" INTEGER,
    "status" "CatalogStatus" NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addon_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_session_id" UUID NOT NULL,
    "item_type" "InventoryItemType" NOT NULL,
    "item_id" UUID NOT NULL,
    "total_quantity" INTEGER,
    "sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "held_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" "InventoryStatus" NOT NULL DEFAULT 'active',
    "seats_io_category_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_checks_name_key" ON "health_checks"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_favorites_event_id_idx" ON "customer_favorites"("event_id");

-- CreateIndex
CREATE INDEX "customer_favorites_customer_id_created_at_idx" ON "customer_favorites"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "media_assets_storage_key_idx" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_created_at_idx" ON "media_assets"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "venues_slug_key" ON "venues"("slug");

-- CreateIndex
CREATE INDEX "venues_status_idx" ON "venues"("status");

-- CreateIndex
CREATE UNIQUE INDEX "venue_translations_venue_id_locale_key" ON "venue_translations"("venue_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "artists_slug_key" ON "artists"("slug");

-- CreateIndex
CREATE INDEX "artists_status_idx" ON "artists"("status");

-- CreateIndex
CREATE UNIQUE INDEX "artist_translations_artist_id_locale_key" ON "artist_translations"("artist_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "event_categories_slug_key" ON "event_categories"("slug");

-- CreateIndex
CREATE INDEX "event_categories_status_sort_order_idx" ON "event_categories"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "event_category_translations_category_id_locale_key" ON "event_category_translations"("category_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE INDEX "events_event_type_status_idx" ON "events"("event_type", "status");

-- CreateIndex
CREATE INDEX "events_category_id_status_starts_at_idx" ON "events"("category_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "events_venue_id_idx" ON "events"("venue_id");

-- CreateIndex
CREATE INDEX "events_seats_io_event_key_idx" ON "events"("seats_io_event_key");

-- CreateIndex
CREATE UNIQUE INDEX "event_translations_event_id_locale_key" ON "event_translations"("event_id", "locale");

-- CreateIndex
CREATE INDEX "event_media_event_id_media_role_sort_order_idx" ON "event_media"("event_id", "media_role", "sort_order");

-- CreateIndex
CREATE INDEX "event_dates_event_id_date_idx" ON "event_dates"("event_id", "date");

-- CreateIndex
CREATE INDEX "event_dates_date_status_idx" ON "event_dates"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_dates_event_id_date_key" ON "event_dates"("event_id", "date");

-- CreateIndex
CREATE INDEX "event_sessions_event_id_starts_at_idx" ON "event_sessions"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_sessions_event_date_id_starts_at_idx" ON "event_sessions"("event_date_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_sessions_status_starts_at_idx" ON "event_sessions"("status", "starts_at");

-- CreateIndex
CREATE INDEX "event_sessions_seats_io_event_key_idx" ON "event_sessions"("seats_io_event_key");

-- CreateIndex
CREATE INDEX "ticket_groups_event_id_sort_order_idx" ON "ticket_groups"("event_id", "sort_order");

-- CreateIndex
CREATE INDEX "ticket_types_event_id_status_sort_order_idx" ON "ticket_types"("event_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_event_id_external_key_key" ON "ticket_types"("event_id", "external_key");

-- CreateIndex
CREATE INDEX "ticket_variants_ticket_type_id_status_sort_order_idx" ON "ticket_variants"("ticket_type_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_variants_ticket_type_id_external_key_key" ON "ticket_variants"("ticket_type_id", "external_key");

-- CreateIndex
CREATE INDEX "ticket_customization_options_ticket_type_id_status_sort_ord_idx" ON "ticket_customization_options"("ticket_type_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_customization_options_ticket_type_id_external_key_key" ON "ticket_customization_options"("ticket_type_id", "external_key");

-- CreateIndex
CREATE INDEX "addons_event_id_status_sort_order_idx" ON "addons"("event_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "addons_event_id_external_key_key" ON "addons"("event_id", "external_key");

-- CreateIndex
CREATE INDEX "addon_variants_addon_id_status_sort_order_idx" ON "addon_variants"("addon_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "addon_variants_addon_id_external_key_key" ON "addon_variants"("addon_id", "external_key");

-- CreateIndex
CREATE INDEX "inventory_items_event_id_event_session_id_idx" ON "inventory_items"("event_id", "event_session_id");

-- CreateIndex
CREATE INDEX "inventory_items_event_session_id_item_type_item_id_idx" ON "inventory_items"("event_session_id", "item_type", "item_id");

-- CreateIndex
CREATE INDEX "inventory_items_status_idx" ON "inventory_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_event_session_id_item_type_item_id_key" ON "inventory_items"("event_session_id", "item_type", "item_id");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_hero_media_id_fkey" FOREIGN KEY ("hero_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_translations" ADD CONSTRAINT "venue_translations_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_profile_media_id_fkey" FOREIGN KEY ("profile_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artist_translations" ADD CONSTRAINT "artist_translations_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_category_translations" ADD CONSTRAINT "event_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "event_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_primary_media_id_fkey" FOREIGN KEY ("primary_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "event_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_dates" ADD CONSTRAINT "event_dates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_date_id_fkey" FOREIGN KEY ("event_date_id") REFERENCES "event_dates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_groups" ADD CONSTRAINT "ticket_groups_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_ticket_group_id_fkey" FOREIGN KEY ("ticket_group_id") REFERENCES "ticket_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_variants" ADD CONSTRAINT "ticket_variants_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_customization_options" ADD CONSTRAINT "ticket_customization_options_ticket_type_id_fkey" FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addons" ADD CONSTRAINT "addons_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_variants" ADD CONSTRAINT "addon_variants_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_event_session_id_fkey" FOREIGN KEY ("event_session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
