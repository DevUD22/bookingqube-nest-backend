-- H1: bind Apple identity to verified `sub`, not a client email.
ALTER TABLE "users" ADD COLUMN "apple_sub" TEXT;
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "users_apple_sub_key" ON "users"("apple_sub");

-- H5: one-time hold release secret (hashed). Existing holds stay owner/admin-only.
ALTER TABLE "ticket_holds" ADD COLUMN "release_token_hash" TEXT;
