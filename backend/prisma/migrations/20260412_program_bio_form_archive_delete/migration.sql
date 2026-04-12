ALTER TABLE "ProgramBioForm"
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ProgramBioForm_isArchived_createdAt_idx"
ON "ProgramBioForm"("isArchived", "createdAt");
