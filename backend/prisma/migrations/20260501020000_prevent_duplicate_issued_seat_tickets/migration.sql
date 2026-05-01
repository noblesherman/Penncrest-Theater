DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Ticket"
    WHERE "seatId" IS NOT NULL
      AND status = 'ISSUED'
    GROUP BY "performanceId", "seatId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create Ticket_one_issued_per_seat: duplicate issued tickets already exist. Cancel or clean up duplicate tickets first.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_one_issued_per_seat"
ON "Ticket" ("performanceId", "seatId")
WHERE "seatId" IS NOT NULL
  AND status = 'ISSUED';
