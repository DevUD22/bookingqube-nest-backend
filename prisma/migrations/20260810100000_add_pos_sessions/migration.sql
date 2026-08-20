-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_sessions_token_hash_key" ON "pos_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "pos_sessions_expires_at_idx" ON "pos_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "pos_sessions_user_id_revoked_at_expires_at_idx" ON "pos_sessions"("user_id", "revoked_at", "expires_at");

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
