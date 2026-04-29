ALTER TABLE "Order"
  ADD COLUMN "cashReceivedCents" INTEGER;

UPDATE "Order"
SET "cashReceivedCents" = "amountTotal"
WHERE "source" = 'DOOR'
  AND "inPersonPaymentMethod" = 'CASH'
  AND "cashReceivedCents" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_cashReceivedCents_idx" ON "Order"("cashReceivedCents");
