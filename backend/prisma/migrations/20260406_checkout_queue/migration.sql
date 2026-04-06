CREATE TYPE "CheckoutQueueStatus" AS ENUM ('WAITING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED', 'CANCELED');

CREATE TABLE "CheckoutQueueItem" (
  "id" TEXT NOT NULL,
  "performanceId" TEXT NOT NULL,
  "holdToken" TEXT NOT NULL,
  "clientToken" TEXT NOT NULL,
  "requestPayloadJson" JSONB NOT NULL,
  "status" "CheckoutQueueStatus" NOT NULL DEFAULT 'WAITING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "processingStartedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "failedReason" TEXT,
  "orderId" TEXT,
  "paymentIntentId" TEXT,
  "clientSecret" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CheckoutQueueItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutQueueItem_holdToken_clientToken_key"
ON "CheckoutQueueItem"("holdToken", "clientToken");

CREATE INDEX "CheckoutQueueItem_status_createdAt_idx"
ON "CheckoutQueueItem"("status", "createdAt");

CREATE INDEX "CheckoutQueueItem_performanceId_status_createdAt_idx"
ON "CheckoutQueueItem"("performanceId", "status", "createdAt");

CREATE INDEX "CheckoutQueueItem_expiresAt_idx"
ON "CheckoutQueueItem"("expiresAt");

ALTER TABLE "CheckoutQueueItem"
ADD CONSTRAINT "CheckoutQueueItem_performanceId_fkey"
FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutQueueItem"
ADD CONSTRAINT "CheckoutQueueItem_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
