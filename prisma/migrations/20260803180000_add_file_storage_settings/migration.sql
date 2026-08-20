-- CreateTable
CREATE TABLE "file_storage_settings" (
    "id" UUID NOT NULL,
    "provider" "StorageProvider" NOT NULL DEFAULT 'azure_blob',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "connection_string" TEXT,
    "container_name" TEXT,
    "public_base_url" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "last_test_message" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_storage_settings_pkey" PRIMARY KEY ("id")
);
