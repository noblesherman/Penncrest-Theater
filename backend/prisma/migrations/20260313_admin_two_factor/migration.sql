ALTER TABLE "AdminUser"
ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "twoFactorSecretEncrypted" TEXT;

CREATE INDEX "AdminUser_role_isActive_twoFactorEnabled_idx"
ON "AdminUser"("role", "isActive", "twoFactorEnabled");

DROP INDEX "AdminUser_role_isActive_idx";
