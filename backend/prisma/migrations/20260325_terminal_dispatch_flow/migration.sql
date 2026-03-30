DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'TerminalDispatchStatus'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "TerminalDispatchStatus" AS ENUM (
      'PENDING',
      'DELIVERED',
      'PROCESSING',
      'FAILED',
      'SUCCEEDED',
      'EXPIRED',
      'CANCELED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TerminalDeviceSession" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT true,
  "registeredByAdminId" TEXT,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDispatchPollAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminalDeviceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TerminalDeviceSession_deviceId_key"
  ON "TerminalDeviceSession"("deviceId");
CREATE INDEX IF NOT EXISTS "TerminalDeviceSession_isOnline_lastHeartbeatAt_idx"
  ON "TerminalDeviceSession"("isOnline", "lastHeartbeatAt");
CREATE INDEX IF NOT EXISTS "TerminalDeviceSession_displayName_idx"
  ON "TerminalDeviceSession"("displayName");

CREATE TABLE IF NOT EXISTS "TerminalPaymentDispatch" (
  "id" TEXT NOT NULL,
  "status" "TerminalDispatchStatus" NOT NULL DEFAULT 'PENDING',
  "performanceId" TEXT NOT NULL,
  "targetDeviceSessionId" TEXT NOT NULL,
  "targetDeviceId" TEXT NOT NULL,
  "holdToken" TEXT NOT NULL,
  "holdExpiresAt" TIMESTAMP(3) NOT NULL,
  "expectedAmountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "stripePaymentIntentId" TEXT,
  "stripePaymentIntentClientSecret" TEXT,
  "saleSnapshot" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "failureReason" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "finalOrderId" TEXT,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TerminalPaymentDispatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TerminalPaymentDispatch_performanceId_fkey"
    FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TerminalPaymentDispatch_targetDeviceSessionId_fkey"
    FOREIGN KEY ("targetDeviceSessionId") REFERENCES "TerminalDeviceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TerminalPaymentDispatch_finalOrderId_fkey"
    FOREIGN KEY ("finalOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TerminalPaymentDispatch_stripePaymentIntentId_key"
  ON "TerminalPaymentDispatch"("stripePaymentIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "TerminalPaymentDispatch_finalOrderId_key"
  ON "TerminalPaymentDispatch"("finalOrderId");
CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_targetDeviceId_status_createdAt_idx"
  ON "TerminalPaymentDispatch"("targetDeviceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_status_holdExpiresAt_idx"
  ON "TerminalPaymentDispatch"("status", "holdExpiresAt");
CREATE INDEX IF NOT EXISTS "TerminalPaymentDispatch_performanceId_createdAt_idx"
  ON "TerminalPaymentDispatch"("performanceId", "createdAt");
