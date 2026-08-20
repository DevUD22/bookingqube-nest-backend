-- AlterTable
ALTER TABLE "events" ADD COLUMN "assign_barcode_offline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "scanner_type" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "scanner_type_other" TEXT;

-- AlterTable
ALTER TABLE "events" ADD COLUMN "barcode_scan_length" INTEGER NOT NULL DEFAULT 8;
