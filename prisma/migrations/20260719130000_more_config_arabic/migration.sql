-- AlterTable
ALTER TABLE "addons" ADD COLUMN IF NOT EXISTS "title_ar" TEXT;
ALTER TABLE "addons" ADD COLUMN IF NOT EXISTS "subtitle_ar" TEXT;

-- AlterTable
ALTER TABLE "taxes" ADD COLUMN IF NOT EXISTS "title_ar" TEXT;

-- AlterTable
ALTER TABLE "registration_form_fields" ADD COLUMN IF NOT EXISTS "label_ar" TEXT;
