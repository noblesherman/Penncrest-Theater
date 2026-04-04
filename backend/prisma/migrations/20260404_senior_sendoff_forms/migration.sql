CREATE TABLE "SeniorSendoffForm" (
  "id" TEXT NOT NULL,
  "showId" TEXT NOT NULL,
  "publicSlug" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'SENIOR_SENDOFF_V1',
  "title" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "isOpen" BOOLEAN NOT NULL DEFAULT true,
  "secondSubmissionPriceCents" INTEGER NOT NULL DEFAULT 2500,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SeniorSendoffForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeniorSendoffSubmission" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "parentName" TEXT NOT NULL,
  "parentEmail" TEXT NOT NULL,
  "parentPhone" TEXT NOT NULL,
  "studentName" TEXT NOT NULL,
  "studentKey" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entryNumber" INTEGER NOT NULL,
  "isPaid" BOOLEAN NOT NULL DEFAULT false,
  "paymentIntentId" TEXT,
  "paymentAmountCents" INTEGER,
  "paymentCurrency" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SeniorSendoffSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeniorSendoffForm_showId_key" ON "SeniorSendoffForm"("showId");
CREATE UNIQUE INDEX "SeniorSendoffForm_publicSlug_key" ON "SeniorSendoffForm"("publicSlug");
CREATE INDEX "SeniorSendoffForm_isOpen_deadlineAt_idx" ON "SeniorSendoffForm"("isOpen", "deadlineAt");

CREATE UNIQUE INDEX "SeniorSendoffSubmission_paymentIntentId_key" ON "SeniorSendoffSubmission"("paymentIntentId");
CREATE UNIQUE INDEX "SeniorSendoffSubmission_formId_parentEmail_studentKey_entryNumber_key" ON "SeniorSendoffSubmission"("formId", "parentEmail", "studentKey", "entryNumber");
CREATE INDEX "SeniorSendoffSubmission_formId_updatedAt_idx" ON "SeniorSendoffSubmission"("formId", "updatedAt");
CREATE INDEX "SeniorSendoffSubmission_formId_parentEmail_studentKey_idx" ON "SeniorSendoffSubmission"("formId", "parentEmail", "studentKey");

ALTER TABLE "SeniorSendoffForm"
  ADD CONSTRAINT "SeniorSendoffForm_showId_fkey"
  FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeniorSendoffSubmission"
  ADD CONSTRAINT "SeniorSendoffSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "SeniorSendoffForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
