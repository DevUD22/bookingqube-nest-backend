-- M5: pending customer email + hashed OTP until the new address is confirmed.
ALTER TABLE "users" ADD COLUMN "pending_email" CITEXT;

CREATE TABLE "email_change_otps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "new_email" CITEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_change_otps_user_id_consumed_at_expires_at_idx" ON "email_change_otps"("user_id", "consumed_at", "expires_at");

ALTER TABLE "email_change_otps" ADD CONSTRAINT "email_change_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
