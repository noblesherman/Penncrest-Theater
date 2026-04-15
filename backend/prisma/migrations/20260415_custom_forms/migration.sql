-- CreateTable
CREATE TABLE "CustomForm" (
  "id" TEXT NOT NULL,
  "publicSlug" TEXT NOT NULL,
  "formName" TEXT NOT NULL,
  "internalDescription" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "schemaVersion" TEXT NOT NULL DEFAULT 'CUSTOM_FORM_V1',
  "definitionJson" JSONB NOT NULL,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFormSubmission" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "responseJson" JSONB NOT NULL,
  "submitterName" TEXT,
  "submitterEmail" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomForm_publicSlug_key" ON "CustomForm"("publicSlug");

-- CreateIndex
CREATE INDEX "CustomForm_status_updatedAt_idx" ON "CustomForm"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "CustomForm_createdAt_idx" ON "CustomForm"("createdAt");

-- CreateIndex
CREATE INDEX "CustomFormSubmission_formId_submittedAt_idx" ON "CustomFormSubmission"("formId", "submittedAt");

-- AddForeignKey
ALTER TABLE "CustomFormSubmission"
  ADD CONSTRAINT "CustomFormSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "CustomForm"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
