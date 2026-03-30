DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'InPersonPaymentMethod'
  ) THEN
    CREATE TYPE "InPersonPaymentMethod" AS ENUM ('STRIPE', 'CASH');
  END IF;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "inPersonPaymentMethod" "InPersonPaymentMethod";

UPDATE "Order"
SET "inPersonPaymentMethod" = 'STRIPE'::"InPersonPaymentMethod"
WHERE "source" = 'DOOR'::"OrderSource"
  AND "inPersonPaymentMethod" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_source_inPersonPaymentMethod_createdAt_idx"
  ON "Order"("source", "inPersonPaymentMethod", "createdAt");
