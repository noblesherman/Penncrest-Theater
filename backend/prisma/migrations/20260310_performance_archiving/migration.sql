-- Add archiving support for performances.
ALTER TABLE "Performance"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Performance_isArchived_startsAt_idx" ON "Performance"("isArchived", "startsAt");
