-- M2: TOTP MFA for admin-panel roles (POS / cafe POS stay password-only).
ALTER TABLE "admin_profiles" ADD COLUMN "mfa_secret_enc" TEXT;
ALTER TABLE "admin_profiles" ADD COLUMN "mfa_enabled_at" TIMESTAMP(3);
ALTER TABLE "admin_profiles" ADD COLUMN "mfa_recovery_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
