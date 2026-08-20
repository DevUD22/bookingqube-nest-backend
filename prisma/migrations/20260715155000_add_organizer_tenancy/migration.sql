CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE "OrganizationMemberRole" AS ENUM ('owner', 'manager', 'analyst');
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('active', 'suspended');

CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_status_name_idx" ON "organizations"("status", "name");

INSERT INTO "organizations" ("id", "slug", "name")
VALUES ('00000000-0000-4000-8000-000000000001', 'bookingqube', 'BookingQube');

CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'manager',
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_status_idx" ON "organization_members"("organization_id", "status");

CREATE TABLE "organizer_sessions" (
    "id" UUID NOT NULL,
    "organization_member_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organizer_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizer_sessions_token_hash_key" ON "organizer_sessions"("token_hash");
CREATE INDEX "organizer_sessions_organization_member_id_revoked_at_expires_at_idx" ON "organizer_sessions"("organization_member_id", "revoked_at", "expires_at");
CREATE INDEX "organizer_sessions_expires_at_idx" ON "organizer_sessions"("expires_at");

ALTER TABLE "events" ADD COLUMN "organization_id" UUID;
UPDATE "events" SET "organization_id" = '00000000-0000-4000-8000-000000000001';
ALTER TABLE "events" ALTER COLUMN "organization_id" SET NOT NULL;
CREATE INDEX "events_organization_id_status_starts_at_idx" ON "events"("organization_id", "status", "starts_at");

ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organizer_sessions" ADD CONSTRAINT "organizer_sessions_organization_member_id_fkey" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
