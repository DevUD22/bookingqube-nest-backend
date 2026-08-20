CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "admin_profile_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
CREATE INDEX "admin_sessions_admin_profile_id_revoked_at_expires_at_idx" ON "admin_sessions"("admin_profile_id", "revoked_at", "expires_at");
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

ALTER TABLE "admin_sessions"
ADD CONSTRAINT "admin_sessions_admin_profile_id_fkey"
FOREIGN KEY ("admin_profile_id") REFERENCES "admin_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
