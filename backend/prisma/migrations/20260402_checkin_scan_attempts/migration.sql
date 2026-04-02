CREATE TYPE "CheckInScanAttemptAction" AS ENUM (
  'SCAN_INVALID_QR',
  'SCAN_NOT_FOUND',
  'SCAN_WRONG_PERFORMANCE',
  'SCAN_NOT_ADMITTED',
  'SCAN_ALREADY_CHECKED_IN'
);

CREATE TABLE "CheckInScanAttempt" (
  "id" TEXT NOT NULL,
  "performanceId" TEXT NOT NULL,
  "scannerSessionId" TEXT,
  "ticketId" TEXT,
  "publicId" TEXT,
  "action" "CheckInScanAttemptAction" NOT NULL,
  "actor" TEXT NOT NULL,
  "gate" TEXT,
  "scannedValue" TEXT,
  "clientScanId" TEXT,
  "offlineQueuedAt" TIMESTAMP(3),
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CheckInScanAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckInScanAttempt_performanceId_createdAt_idx"
  ON "CheckInScanAttempt"("performanceId", "createdAt");

CREATE INDEX "CheckInScanAttempt_performanceId_action_createdAt_idx"
  ON "CheckInScanAttempt"("performanceId", "action", "createdAt");

CREATE INDEX "CheckInScanAttempt_scannerSessionId_createdAt_idx"
  ON "CheckInScanAttempt"("scannerSessionId", "createdAt");

CREATE INDEX "CheckInScanAttempt_ticketId_createdAt_idx"
  ON "CheckInScanAttempt"("ticketId", "createdAt");

ALTER TABLE "CheckInScanAttempt"
  ADD CONSTRAINT "CheckInScanAttempt_performanceId_fkey"
  FOREIGN KEY ("performanceId") REFERENCES "Performance"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckInScanAttempt"
  ADD CONSTRAINT "CheckInScanAttempt_scannerSessionId_fkey"
  FOREIGN KEY ("scannerSessionId") REFERENCES "ScannerSession"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CheckInScanAttempt"
  ADD CONSTRAINT "CheckInScanAttempt_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
