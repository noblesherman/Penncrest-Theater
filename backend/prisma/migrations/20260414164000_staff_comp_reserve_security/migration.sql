CREATE TYPE "StaffCompReserveAttemptOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED');

CREATE TYPE "StaffCompReserveLockoutKeyType" AS ENUM ('IP', 'EMAIL', 'PROMO_CODE');

CREATE TABLE "StaffCompReserveAttempt" (
  "id" TEXT NOT NULL,
  "requestedPerformanceId" TEXT,
  "clientIp" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "promoCodeHash" TEXT NOT NULL,
  "outcome" "StaffCompReserveAttemptOutcome" NOT NULL,
  "failureReason" TEXT,
  "lockoutApplied" BOOLEAN NOT NULL DEFAULT false,
  "orderId" TEXT,
  "ticketId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StaffCompReserveAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffCompReserveAttempt_createdAt_idx"
  ON "StaffCompReserveAttempt"("createdAt");

CREATE INDEX "StaffCompReserveAttempt_requestedPerformanceId_createdAt_idx"
  ON "StaffCompReserveAttempt"("requestedPerformanceId", "createdAt");

CREATE INDEX "StaffCompReserveAttempt_clientIp_createdAt_idx"
  ON "StaffCompReserveAttempt"("clientIp", "createdAt");

CREATE INDEX "StaffCompReserveAttempt_customerEmail_createdAt_idx"
  ON "StaffCompReserveAttempt"("customerEmail", "createdAt");

CREATE INDEX "StaffCompReserveAttempt_promoCodeHash_createdAt_idx"
  ON "StaffCompReserveAttempt"("promoCodeHash", "createdAt");

CREATE INDEX "StaffCompReserveAttempt_outcome_createdAt_idx"
  ON "StaffCompReserveAttempt"("outcome", "createdAt");

CREATE TABLE "StaffCompReserveLockout" (
  "id" TEXT NOT NULL,
  "keyType" "StaffCompReserveLockoutKeyType" NOT NULL,
  "keyValue" TEXT NOT NULL,
  "lockedUntil" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffCompReserveLockout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffCompReserveLockout_keyType_keyValue_key"
  ON "StaffCompReserveLockout"("keyType", "keyValue");

CREATE INDEX "StaffCompReserveLockout_lockedUntil_idx"
  ON "StaffCompReserveLockout"("lockedUntil");
