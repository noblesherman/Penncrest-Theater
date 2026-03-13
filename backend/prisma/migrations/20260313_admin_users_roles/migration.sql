CREATE TYPE "AdminRole" AS ENUM ('BOX_OFFICE', 'ADMIN', 'SUPER_ADMIN');

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'BOX_OFFICE',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
CREATE INDEX "AdminUser_role_isActive_idx" ON "AdminUser"("role", "isActive");
