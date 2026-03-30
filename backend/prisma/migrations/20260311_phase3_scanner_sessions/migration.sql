-- Phase 3 scanner sessions, supervisor admission decisions, and analytics support.
CREATE TYPE "AdmissionDecision" AS ENUM ('FORCE_ADMIT', 'DENY');

ALTER TABLE "Ticket"
  ADD COLUMN "admissionDecision" "AdmissionDecision",
  ADD COLUMN "admissionReason" TEXT,
  ADD COLUMN "admissionDecidedAt" TIMESTAMP(3),
  ADD COLUMN "admissionDecidedBy" TEXT;

CREATE INDEX "Ticket_performanceId_admissionDecision_idx" ON "Ticket"("performanceId", "admissionDecision");

CREATE TABLE "ScannerSession" (
  "id" TEXT NOT NULL,
  "performanceId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "staffName" TEXT NOT NULL,
  "gate" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScannerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScannerSession_accessToken_key" ON "ScannerSession"("accessToken");
CREATE INDEX "ScannerSession_performanceId_active_idx" ON "ScannerSession"("performanceId", "active");
CREATE INDEX "ScannerSession_performanceId_gate_active_idx" ON "ScannerSession"("performanceId", "gate", "active");
CREATE INDEX "ScannerSession_lastSeenAt_idx" ON "ScannerSession"("lastSeenAt");

ALTER TABLE "ScannerSession"
  ADD CONSTRAINT "ScannerSession_performanceId_fkey"
  FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
