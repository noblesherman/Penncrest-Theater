-- Enums
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'DOOR', 'COMP', 'STAFF_FREE', 'FAMILY_FREE');

-- Performance options
ALTER TABLE "Performance"
  ADD COLUMN "salesCutoffAt" TIMESTAMP(3),
  ADD COLUMN "staffTicketLimit" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "familyFreeTicketEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Seat companion metadata
ALTER TABLE "Seat"
  ADD COLUMN "isCompanion" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "companionForSeatId" TEXT;

ALTER TABLE "Seat"
  ADD CONSTRAINT "Seat_companionForSeatId_fkey"
  FOREIGN KEY ("companionForSeatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Order source and ticket metadata
ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'ONLINE';

ALTER TABLE "OrderSeat"
  ADD COLUMN "ticketType" TEXT,
  ADD COLUMN "isComplimentary" BOOLEAN NOT NULL DEFAULT false;

-- Indexes
CREATE INDEX "Performance_salesCutoffAt_idx" ON "Performance"("salesCutoffAt");
CREATE INDEX "Seat_companionForSeatId_idx" ON "Seat"("companionForSeatId");
CREATE INDEX "Order_source_idx" ON "Order"("source");
