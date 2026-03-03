-- Enums
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED');
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONVERTED', 'CANCELED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'CANCELED');

-- Tables
CREATE TABLE "Show" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "posterUrl" TEXT,
  "type" TEXT,
  "year" INTEGER,
  "accentColor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Performance" (
  "id" TEXT PRIMARY KEY,
  "showId" TEXT NOT NULL,
  "title" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "venue" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Performance_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PricingTier" (
  "id" TEXT PRIMARY KEY,
  "performanceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PricingTier_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "HoldSession" (
  "id" TEXT PRIMARY KEY,
  "performanceId" TEXT NOT NULL,
  "clientToken" TEXT NOT NULL,
  "holdToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HoldSession_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Seat" (
  "id" TEXT PRIMARY KEY,
  "performanceId" TEXT NOT NULL,
  "row" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "sectionName" TEXT NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "price" INTEGER NOT NULL,
  "isAccessible" BOOLEAN NOT NULL DEFAULT false,
  "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
  "holdSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Seat_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Seat_holdSessionId_fkey" FOREIGN KEY ("holdSessionId") REFERENCES "HoldSession"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "SeatHold" (
  "id" TEXT PRIMARY KEY,
  "seatId" TEXT NOT NULL,
  "holdSessionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeatHold_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SeatHold_holdSessionId_fkey" FOREIGN KEY ("holdSessionId") REFERENCES "HoldSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Order" (
  "id" TEXT PRIMARY KEY,
  "performanceId" TEXT NOT NULL,
  "stripeSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "email" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "attendeeNamesJson" JSONB,
  "amountTotal" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "holdToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "Performance"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OrderSeat" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "seatId" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "attendeeName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderSeat_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderSeat_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Ticket" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "seatId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "qrSecret" TEXT NOT NULL,
  "qrPayload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Ticket_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes and constraints
CREATE UNIQUE INDEX "HoldSession_holdToken_key" ON "HoldSession"("holdToken");
CREATE UNIQUE INDEX "HoldSession_performanceId_clientToken_key" ON "HoldSession"("performanceId", "clientToken");

CREATE UNIQUE INDEX "Seat_performanceId_sectionName_row_number_key" ON "Seat"("performanceId", "sectionName", "row", "number");
CREATE INDEX "Seat_performanceId_status_idx" ON "Seat"("performanceId", "status");
CREATE INDEX "Seat_holdSessionId_idx" ON "Seat"("holdSessionId");

CREATE UNIQUE INDEX "SeatHold_seatId_key" ON "SeatHold"("seatId");
CREATE UNIQUE INDEX "SeatHold_holdSessionId_seatId_key" ON "SeatHold"("holdSessionId", "seatId");
CREATE INDEX "SeatHold_holdSessionId_idx" ON "SeatHold"("holdSessionId");

CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");
CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key" ON "Order"("stripePaymentIntentId");
CREATE INDEX "Order_performanceId_idx" ON "Order"("performanceId");
CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_status_idx" ON "Order"("status");

CREATE UNIQUE INDEX "OrderSeat_orderId_seatId_key" ON "OrderSeat"("orderId", "seatId");
CREATE INDEX "OrderSeat_seatId_idx" ON "OrderSeat"("seatId");
CREATE INDEX "OrderSeat_orderId_idx" ON "OrderSeat"("orderId");

CREATE UNIQUE INDEX "Ticket_publicId_key" ON "Ticket"("publicId");
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");
CREATE INDEX "Ticket_seatId_idx" ON "Ticket"("seatId");

CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX "Performance_showId_idx" ON "Performance"("showId");
CREATE INDEX "Performance_startsAt_idx" ON "Performance"("startsAt");
CREATE INDEX "PricingTier_performanceId_idx" ON "PricingTier"("performanceId");
CREATE INDEX "HoldSession_performanceId_expiresAt_idx" ON "HoldSession"("performanceId", "expiresAt");
