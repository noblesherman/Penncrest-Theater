DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'FINALIZATION_FAILED'
      AND enumtypid = to_regtype('"OrderStatus"')
  ) THEN
    ALTER TYPE "OrderStatus" ADD VALUE 'FINALIZATION_FAILED';
  END IF;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "accessToken" TEXT,
  ADD COLUMN IF NOT EXISTS "finalizationAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "finalizationFailedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastFinalizationError" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeRefundStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refundRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastRefundError" TEXT,
  ADD COLUMN IF NOT EXISTS "releaseSeatsOnRefund" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Order"
SET "accessToken" = md5(random()::text || clock_timestamp()::text || "id") || md5(random()::text || clock_timestamp()::text || coalesce("email", ''))
WHERE "accessToken" IS NULL;

ALTER TABLE "Order"
  ALTER COLUMN "accessToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_accessToken_key" ON "Order"("accessToken");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_stripeRefundId_key" ON "Order"("stripeRefundId");
CREATE INDEX IF NOT EXISTS "Order_accessToken_idx" ON "Order"("accessToken");
