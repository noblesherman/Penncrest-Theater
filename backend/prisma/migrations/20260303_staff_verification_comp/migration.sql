-- Enums
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'LOCAL');
CREATE TYPE "StaffVerifyMethod" AS ENUM ('OAUTH_GOOGLE', 'OAUTH_MICROSOFT', 'REDEEM_CODE');
CREATE TYPE "TicketType" AS ENUM ('PAID', 'STAFF_COMP');
CREATE TYPE "TicketStatus" AS ENUM ('RESERVED', 'ISSUED', 'CANCELLED');

ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'STAFF_COMP';

-- User table
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "authProvider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
  "verifiedStaff" BOOLEAN NOT NULL DEFAULT false,
  "staffVerifiedAt" TIMESTAMP(3),
  "staffVerifyMethod" "StaffVerifyMethod",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_verifiedStaff_staffVerifiedAt_idx" ON "User"("verifiedStaff", "staffVerifiedAt");

-- Redeem code table
CREATE TABLE "StaffRedeemCode" (
  "id" TEXT PRIMARY KEY,
  "codeHash" TEXT NOT NULL,
  "createdByAdminId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "usedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRedeemCode_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StaffRedeemCode_codeHash_key" ON "StaffRedeemCode"("codeHash");
CREATE INDEX "StaffRedeemCode_expiresAt_usedAt_idx" ON "StaffRedeemCode"("expiresAt", "usedAt");
CREATE INDEX "StaffRedeemCode_createdByAdminId_createdAt_idx" ON "StaffRedeemCode"("createdByAdminId", "createdAt");

-- Performance config for staff comps
ALTER TABLE "Performance"
  ADD COLUMN "staffCompsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "staffCompLimitPerUser" INTEGER NOT NULL DEFAULT 1;

-- Order relation to User
ALTER TABLE "Order"
  ADD COLUMN "userId" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- Ticket enrichment
ALTER TABLE "Ticket"
  ADD COLUMN "performanceId" TEXT,
  ADD COLUMN "userId" TEXT,
  ADD COLUMN "type" "TicketType" NOT NULL DEFAULT 'PAID',
  ADD COLUMN "priceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "TicketStatus" NOT NULL DEFAULT 'ISSUED';

UPDATE "Ticket" AS t
SET
  "performanceId" = o."performanceId",
  "priceCents" = COALESCE((
    SELECT os."price"
    FROM "OrderSeat" AS os
    WHERE os."orderId" = t."orderId" AND os."seatId" = t."seatId"
    LIMIT 1
  ), 0),
  "type" = CASE
    WHEN o."source" = 'STAFF_FREE' THEN 'STAFF_COMP'::"TicketType"
    ELSE 'PAID'::"TicketType"
  END,
  "status" = 'ISSUED'::"TicketStatus"
FROM "Order" AS o
WHERE o."id" = t."orderId"
;

ALTER TABLE "Ticket"
  ALTER COLUMN "performanceId" SET NOT NULL;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_performanceId_fkey"
  FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Ticket_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Ticket_performanceId_idx" ON "Ticket"("performanceId");
CREATE INDEX "Ticket_userId_idx" ON "Ticket"("userId");
CREATE INDEX "Ticket_type_status_idx" ON "Ticket"("type", "status");

-- Staff comp redemption ledger
CREATE TABLE "StaffCompRedemption" (
  "id" TEXT PRIMARY KEY,
  "performanceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffCompRedemption_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StaffCompRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StaffCompRedemption_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "StaffCompRedemption_ticketId_key" ON "StaffCompRedemption"("ticketId");
CREATE UNIQUE INDEX "StaffCompRedemption_performanceId_userId_key" ON "StaffCompRedemption"("performanceId", "userId");
CREATE INDEX "StaffCompRedemption_performanceId_redeemedAt_idx" ON "StaffCompRedemption"("performanceId", "redeemedAt");
CREATE INDEX "StaffCompRedemption_userId_redeemedAt_idx" ON "StaffCompRedemption"("userId", "redeemedAt");

-- AuditLog enrichment
ALTER TABLE "AuditLog"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "actorAdminId" TEXT,
  ADD COLUMN "meta" JSONB;

CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX "AuditLog_actorAdminId_createdAt_idx" ON "AuditLog"("actorAdminId", "createdAt");
