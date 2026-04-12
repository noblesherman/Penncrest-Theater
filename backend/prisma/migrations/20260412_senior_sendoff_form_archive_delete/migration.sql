ALTER TABLE "SeniorSendoffForm"
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "SeniorSendoffForm_isArchived_createdAt_idx"
ON "SeniorSendoffForm"("isArchived", "createdAt");
