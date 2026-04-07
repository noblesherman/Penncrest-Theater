ALTER TABLE "Performance"
ADD COLUMN "onlineSalesStartsAt" TIMESTAMP(3),
ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Performance_isPublished_onlineSalesStartsAt_idx"
ON "Performance"("isPublished", "onlineSalesStartsAt");
