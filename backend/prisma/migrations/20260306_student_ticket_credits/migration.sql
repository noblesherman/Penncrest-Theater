ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'STUDENT_COMP';
ALTER TYPE "TicketType" ADD VALUE IF NOT EXISTS 'STUDENT_COMP';

CREATE TYPE "StudentCreditTransactionType" AS ENUM (
  'REDEEM',
  'ADJUSTMENT_ADD',
  'ADJUSTMENT_REMOVE',
  'MANUAL_REDEEM',
  'REFUND_RESTORE'
);

CREATE TYPE "StudentCreditVerificationMethod" AS ENUM (
  'CODE',
  'SCHOOL_LOGIN',
  'ADMIN'
);

CREATE TABLE "StudentTicketCredit" (
  "id" TEXT PRIMARY KEY,
  "showId" TEXT NOT NULL,
  "studentId" TEXT,
  "studentName" TEXT NOT NULL,
  "studentEmail" TEXT,
  "roleName" TEXT,
  "verificationCode" TEXT,
  "allocatedTickets" INTEGER NOT NULL DEFAULT 2,
  "usedTickets" INTEGER NOT NULL DEFAULT 0,
  "pendingTickets" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudentTicketCredit_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StudentTicketCredit_verificationCode_key" ON "StudentTicketCredit"("verificationCode");
CREATE INDEX "StudentTicketCredit_showId_isActive_idx" ON "StudentTicketCredit"("showId", "isActive");

CREATE TABLE "StudentTicketCreditTransaction" (
  "id" TEXT PRIMARY KEY,
  "studentTicketCreditId" TEXT NOT NULL,
  "orderId" TEXT,
  "performanceId" TEXT,
  "quantity" INTEGER NOT NULL,
  "type" "StudentCreditTransactionType" NOT NULL,
  "verificationMethod" "StudentCreditVerificationMethod",
  "redeemedBy" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentTicketCreditTransaction_studentTicketCreditId_fkey"
    FOREIGN KEY ("studentTicketCreditId") REFERENCES "StudentTicketCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StudentTicketCreditTransaction_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "StudentTicketCreditTransaction_performanceId_fkey"
    FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "Order"
  ADD COLUMN "studentTicketCreditId" TEXT,
  ADD COLUMN "studentCreditPendingQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "studentCreditRedeemedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "studentCreditRestoredQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "studentCreditVerificationMethod" "StudentCreditVerificationMethod";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_studentTicketCreditId_fkey"
  FOREIGN KEY ("studentTicketCreditId") REFERENCES "StudentTicketCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_studentTicketCreditId_idx" ON "Order"("studentTicketCreditId");
CREATE INDEX "StudentTicketCreditTransaction_studentTicketCreditId_createdAt_idx"
  ON "StudentTicketCreditTransaction"("studentTicketCreditId", "createdAt");
CREATE INDEX "StudentTicketCreditTransaction_orderId_idx" ON "StudentTicketCreditTransaction"("orderId");
CREATE INDEX "StudentTicketCreditTransaction_performanceId_idx" ON "StudentTicketCreditTransaction"("performanceId");
