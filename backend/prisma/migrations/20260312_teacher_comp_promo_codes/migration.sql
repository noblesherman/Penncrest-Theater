CREATE TABLE "TeacherCompPromoCode" (
  "id" TEXT PRIMARY KEY,
  "codeHash" TEXT NOT NULL,
  "createdByAdminId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "TeacherCompPromoCode_codeHash_key" ON "TeacherCompPromoCode"("codeHash");
CREATE INDEX "TeacherCompPromoCode_active_expiresAt_createdAt_idx" ON "TeacherCompPromoCode"("active", "expiresAt", "createdAt");
CREATE INDEX "TeacherCompPromoCode_createdByAdminId_createdAt_idx" ON "TeacherCompPromoCode"("createdByAdminId", "createdAt");
