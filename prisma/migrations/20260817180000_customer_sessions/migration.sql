CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");
CREATE INDEX "customer_sessions_user_id_revoked_at_expires_at_idx" ON "customer_sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions"("expires_at");

ALTER TABLE "customer_sessions"
ADD CONSTRAINT "customer_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
