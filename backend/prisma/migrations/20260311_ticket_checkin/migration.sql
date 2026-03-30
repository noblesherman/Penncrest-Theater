-- Add ticket check-in tracking fields for scanner workflow.
ALTER TABLE "Ticket"
  ADD COLUMN "checkedInAt" TIMESTAMP(3),
  ADD COLUMN "checkedInBy" TEXT,
  ADD COLUMN "checkInGate" TEXT;

CREATE INDEX "Ticket_performanceId_checkedInAt_idx" ON "Ticket"("performanceId", "checkedInAt");
