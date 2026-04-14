CREATE TYPE "TicketEmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "TicketEmailOutbox" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "status" "TicketEmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "processingStartedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TicketEmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketEmailOutbox_orderId_key"
  ON "TicketEmailOutbox"("orderId");

CREATE INDEX "TicketEmailOutbox_status_nextAttemptAt_createdAt_idx"
  ON "TicketEmailOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "TicketEmailOutbox_processingStartedAt_idx"
  ON "TicketEmailOutbox"("processingStartedAt");

ALTER TABLE "TicketEmailOutbox"
  ADD CONSTRAINT "TicketEmailOutbox_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
