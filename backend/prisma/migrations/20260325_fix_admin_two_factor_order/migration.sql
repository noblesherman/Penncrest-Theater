ALTER TABLE "AdminUser"
ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "twoFactorSecretEncrypted" TEXT;

DROP INDEX IF EXISTS "AdminUser_role_isActive_idx";
CREATE INDEX IF NOT EXISTS "AdminUser_role_isActive_twoFactorEnabled_idx"
ON "AdminUser"("role", "isActive", "twoFactorEnabled");
