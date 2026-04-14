-- CreateEnum
CREATE TYPE "EventRegistrationFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "EventRegistrationForm" (
  "id" TEXT NOT NULL,
  "performanceId" TEXT NOT NULL,
  "formName" TEXT NOT NULL DEFAULT 'Event Registration Form',
  "internalDescription" TEXT,
  "status" "EventRegistrationFormStatus" NOT NULL DEFAULT 'DRAFT',
  "settingsJson" JSONB NOT NULL,
  "draftDefinitionJson" JSONB NOT NULL,
  "publishedVersionId" TEXT,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventRegistrationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistrationFormVersion" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "formName" TEXT NOT NULL,
  "settingsJson" JSONB NOT NULL,
  "definitionJson" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventRegistrationFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistrationSubmission" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "performanceId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "responseJson" JSONB NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventRegistrationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationForm_performanceId_key" ON "EventRegistrationForm"("performanceId");

-- CreateIndex
CREATE INDEX "EventRegistrationForm_status_updatedAt_idx" ON "EventRegistrationForm"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationFormVersion_formId_versionNumber_key" ON "EventRegistrationFormVersion"("formId", "versionNumber");

-- CreateIndex
CREATE INDEX "EventRegistrationFormVersion_formId_publishedAt_idx" ON "EventRegistrationFormVersion"("formId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationSubmission_orderId_key" ON "EventRegistrationSubmission"("orderId");

-- CreateIndex
CREATE INDEX "EventRegistrationSubmission_performanceId_submittedAt_idx" ON "EventRegistrationSubmission"("performanceId", "submittedAt");

-- CreateIndex
CREATE INDEX "EventRegistrationSubmission_formId_submittedAt_idx" ON "EventRegistrationSubmission"("formId", "submittedAt");

-- AddForeignKey
ALTER TABLE "EventRegistrationForm"
  ADD CONSTRAINT "EventRegistrationForm_performanceId_fkey"
  FOREIGN KEY ("performanceId") REFERENCES "Performance"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationFormVersion"
  ADD CONSTRAINT "EventRegistrationFormVersion_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "EventRegistrationForm"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationForm"
  ADD CONSTRAINT "EventRegistrationForm_publishedVersionId_fkey"
  FOREIGN KEY ("publishedVersionId") REFERENCES "EventRegistrationFormVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationSubmission"
  ADD CONSTRAINT "EventRegistrationSubmission_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationSubmission"
  ADD CONSTRAINT "EventRegistrationSubmission_performanceId_fkey"
  FOREIGN KEY ("performanceId") REFERENCES "Performance"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationSubmission"
  ADD CONSTRAINT "EventRegistrationSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "EventRegistrationForm"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationSubmission"
  ADD CONSTRAINT "EventRegistrationSubmission_formVersionId_fkey"
  FOREIGN KEY ("formVersionId") REFERENCES "EventRegistrationFormVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
