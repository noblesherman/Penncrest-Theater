ALTER TABLE "ContentPage"
  ADD COLUMN IF NOT EXISTS "draftContent" JSONB,
  ADD COLUMN IF NOT EXISTS "publishedContent" JSONB,
  ADD COLUMN IF NOT EXISTS "catalogDraft" JSONB,
  ADD COLUMN IF NOT EXISTS "catalogPublished" JSONB,
  ADD COLUMN IF NOT EXISTS "draftDeleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publishedDeleted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ContentPage"
SET "publishedContent" = "content"
WHERE "scope" = 'about'
  AND "publishedContent" IS NULL;

UPDATE "ContentPage"
SET "draftContent" = COALESCE("publishedContent", "content")
WHERE "scope" = 'about'
  AND "draftContent" IS NULL;
