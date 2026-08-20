-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "hero_media_id" UUID,
    "author_user_id" UUID,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "valid_until" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_translations" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "category" TEXT,
    "tag" TEXT,
    "tags_json" JSONB,

    CONSTRAINT "offer_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_events" (
    "offer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "offer_events_pkey" PRIMARY KEY ("offer_id","event_id")
);

-- CreateTable
CREATE TABLE "homepage_faqs" (
    "id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homepage_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "footer_contents" (
    "id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "content_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "footer_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offers_slug_key" ON "offers"("slug");

-- CreateIndex
CREATE INDEX "offers_status_sort_order_published_at_idx" ON "offers"("status", "sort_order", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "offer_translations_offer_id_locale_key" ON "offer_translations"("offer_id", "locale");

-- CreateIndex
CREATE INDEX "offer_events_event_id_idx" ON "offer_events"("event_id");

-- CreateIndex
CREATE INDEX "homepage_faqs_locale_status_sort_order_idx" ON "homepage_faqs"("locale", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "footer_contents_locale_key" ON "footer_contents"("locale");

-- CreateIndex
CREATE INDEX "footer_contents_status_idx" ON "footer_contents"("status");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_hero_media_id_fkey" FOREIGN KEY ("hero_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_translations" ADD CONSTRAINT "offer_translations_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_events" ADD CONSTRAINT "offer_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
