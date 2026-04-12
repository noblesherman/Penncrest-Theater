ALTER TABLE "TerminalPaymentDispatch"
  ADD COLUMN IF NOT EXISTS "queueKey" TEXT,
  ADD COLUMN IF NOT EXISTS "queueSortAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sellerStationName" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerAdminId" TEXT,
  ADD COLUMN IF NOT EXISTS "sellerClientSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "processingHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "activeTimeoutAt" TIMESTAMP(3);

UPDATE "TerminalPaymentDispatch"
SET
  "queueKey" = COALESCE("queueKey", "targetDeviceId"),
  "queueSortAt" = COALESCE("queueSortAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "queueKey" IS NULL OR "queueSortAt" IS NULL;

ALTER TABLE "TerminalPaymentDispatch"
  ALTER COLUMN "queueKey" SET NOT NULL,
  ALTER COLUMN "queueSortAt" SET NOT NULL,
  ALTER COLUMN "queueSortAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_queueKey_status_queueSortAt_idx"
  ON "TerminalPaymentDispatch"("queueKey", "status", "queueSortAt");
CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_sellerClientSessionId_createdAt_idx"
  ON "TerminalPaymentDispatch"("sellerClientSessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_status_activeTimeoutAt_idx"
  ON "TerminalPaymentDispatch"("status", "activeTimeoutAt");

WITH ranked_processing AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "queueKey"
      ORDER BY COALESCE("processingStartedAt", "createdAt") ASC, "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "TerminalPaymentDispatch"
  WHERE "status" = 'PROCESSING'
)
UPDATE "TerminalPaymentDispatch" d
SET
  "status" = 'FAILED',
  "failureReason" = COALESCE(d."failureReason", 'Recovered conflicting active payment lock'),
  "updatedAt" = CURRENT_TIMESTAMP,
  "activeTimeoutAt" = NULL
FROM ranked_processing r
WHERE d."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "TerminalPaymentDispatch_one_processing_per_queue_idx"
  ON "TerminalPaymentDispatch"("queueKey")
  WHERE "status" = 'PROCESSING';
