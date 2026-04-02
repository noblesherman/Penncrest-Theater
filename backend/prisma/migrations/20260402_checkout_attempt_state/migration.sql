CREATE TYPE "CheckoutAttemptState" AS ENUM ('NONE', 'CREATING_PAYMENT_INTENT', 'AWAITING_PAYMENT', 'FAILED', 'EXPIRED');

ALTER TABLE "Order"
ADD COLUMN "checkoutAttemptState" "CheckoutAttemptState" NOT NULL DEFAULT 'NONE',
ADD COLUMN "checkoutAttemptExpiresAt" TIMESTAMP(3);

CREATE INDEX "Order_status_checkoutAttemptState_checkoutAttemptExpiresAt_idx"
ON "Order"("status", "checkoutAttemptState", "checkoutAttemptExpiresAt");
