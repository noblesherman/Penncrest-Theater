CREATE TABLE IF NOT EXISTS "ContentPage" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentPage_scope_slug_key" ON "ContentPage"("scope", "slug");
CREATE INDEX IF NOT EXISTS "ContentPage_scope_idx" ON "ContentPage"("scope");
CREATE INDEX IF NOT EXISTS "ContentPage_updatedByAdminId_idx" ON "ContentPage"("updatedByAdminId");
