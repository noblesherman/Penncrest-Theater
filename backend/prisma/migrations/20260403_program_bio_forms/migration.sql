ALTER TABLE "CastMember"
  ADD COLUMN "schoolEmail" TEXT,
  ADD COLUMN "gradeLevel" INTEGER,
  ADD COLUMN "bio" TEXT;

CREATE UNIQUE INDEX "CastMember_showId_schoolEmail_key" ON "CastMember"("showId", "schoolEmail");

CREATE TABLE "ProgramBioForm" (
  "id" TEXT NOT NULL,
  "showId" TEXT NOT NULL,
  "publicSlug" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'PROGRAM_BIO_V1',
  "title" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "isOpen" BOOLEAN NOT NULL DEFAULT true,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProgramBioForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgramBioSubmission" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "schoolEmail" TEXT NOT NULL,
  "gradeLevel" INTEGER NOT NULL,
  "roleInShow" TEXT NOT NULL,
  "bio" TEXT NOT NULL,
  "headshotUrl" TEXT NOT NULL,
  "headshotKey" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProgramBioSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramBioForm_showId_key" ON "ProgramBioForm"("showId");
CREATE UNIQUE INDEX "ProgramBioForm_publicSlug_key" ON "ProgramBioForm"("publicSlug");
CREATE INDEX "ProgramBioForm_isOpen_deadlineAt_idx" ON "ProgramBioForm"("isOpen", "deadlineAt");

CREATE UNIQUE INDEX "ProgramBioSubmission_formId_schoolEmail_key" ON "ProgramBioSubmission"("formId", "schoolEmail");
CREATE INDEX "ProgramBioSubmission_formId_updatedAt_idx" ON "ProgramBioSubmission"("formId", "updatedAt");

ALTER TABLE "ProgramBioForm"
  ADD CONSTRAINT "ProgramBioForm_showId_fkey"
  FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramBioSubmission"
  ADD CONSTRAINT "ProgramBioSubmission_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "ProgramBioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
