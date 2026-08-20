-- AlterTable
ALTER TABLE "roles" ADD COLUMN "is_third_party_shareholder" BOOLEAN NOT NULL DEFAULT false;

-- Built-in event managers are always third-party shareholder scoped.
UPDATE "roles"
SET "is_third_party_shareholder" = true
WHERE "name" IN ('event_manager', 'event-manager');
