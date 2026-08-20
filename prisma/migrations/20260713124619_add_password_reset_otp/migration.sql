-- CreateTable
CREATE TABLE "password_reset_otps" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_otps_email_consumed_at_expires_at_idx" ON "password_reset_otps"("email", "consumed_at", "expires_at");
