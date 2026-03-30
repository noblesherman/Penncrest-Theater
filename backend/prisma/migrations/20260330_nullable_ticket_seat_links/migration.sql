-- Make seat links optional for GA/no-seat ticket mode.
ALTER TABLE "OrderSeat" DROP CONSTRAINT "OrderSeat_seatId_fkey";
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_seatId_fkey";

ALTER TABLE "OrderSeat" ALTER COLUMN "seatId" DROP NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "seatId" DROP NOT NULL;

ALTER TABLE "OrderSeat"
  ADD CONSTRAINT "OrderSeat_seatId_fkey"
  FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_seatId_fkey"
  FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
