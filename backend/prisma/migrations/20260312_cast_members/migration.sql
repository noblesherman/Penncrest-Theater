-- CreateTable
CREATE TABLE "CastMember" (
  "id" TEXT NOT NULL,
  "showId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "photoUrl" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CastMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CastMember_showId_position_idx" ON "CastMember"("showId", "position");

-- AddForeignKey
ALTER TABLE "CastMember" ADD CONSTRAINT "CastMember_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;
