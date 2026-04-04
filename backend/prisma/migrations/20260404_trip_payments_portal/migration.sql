-- Trip payments portal models
CREATE TYPE "TripPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

CREATE TABLE "Trip" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "destination" TEXT,
  "startsAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3) NOT NULL,
  "defaultCostCents" INTEGER NOT NULL,
  "allowPartialPayments" BOOLEAN NOT NULL DEFAULT false,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripDocument" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileKey" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripStudent" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "grade" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripStudent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "studentId" TEXT,
  "stripeCustomerId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripEnrollment" (
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "targetAmountCents" INTEGER NOT NULL,
  "dueAtOverride" TIMESTAMP(3),
  "claimedByAccountId" TEXT,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripLoginCode" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripPayment" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "status" "TripPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TripBalanceAdjustment" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "previousTargetAmountCents" INTEGER NOT NULL,
  "newTargetAmountCents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actorAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TripBalanceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Trip_slug_key" ON "Trip"("slug");
CREATE INDEX "Trip_isPublished_isArchived_dueAt_idx" ON "Trip"("isPublished", "isArchived", "dueAt");
CREATE INDEX "Trip_startsAt_idx" ON "Trip"("startsAt");

CREATE INDEX "TripDocument_tripId_sortOrder_createdAt_idx" ON "TripDocument"("tripId", "sortOrder", "createdAt");
CREATE INDEX "TripStudent_isActive_name_idx" ON "TripStudent"("isActive", "name");

CREATE UNIQUE INDEX "TripAccount_email_key" ON "TripAccount"("email");
CREATE UNIQUE INDEX "TripAccount_studentId_key" ON "TripAccount"("studentId");
CREATE INDEX "TripAccount_isActive_lastLoginAt_idx" ON "TripAccount"("isActive", "lastLoginAt");

CREATE UNIQUE INDEX "TripEnrollment_tripId_studentId_key" ON "TripEnrollment"("tripId", "studentId");
CREATE INDEX "TripEnrollment_studentId_tripId_idx" ON "TripEnrollment"("studentId", "tripId");
CREATE INDEX "TripEnrollment_claimedByAccountId_idx" ON "TripEnrollment"("claimedByAccountId");
CREATE INDEX "TripEnrollment_dueAtOverride_idx" ON "TripEnrollment"("dueAtOverride");

CREATE INDEX "TripLoginCode_accountId_createdAt_idx" ON "TripLoginCode"("accountId", "createdAt");
CREATE INDEX "TripLoginCode_accountId_expiresAt_consumedAt_idx" ON "TripLoginCode"("accountId", "expiresAt", "consumedAt");

CREATE UNIQUE INDEX "TripPayment_stripeCheckoutSessionId_key" ON "TripPayment"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "TripPayment_stripePaymentIntentId_key" ON "TripPayment"("stripePaymentIntentId");
CREATE INDEX "TripPayment_enrollmentId_status_createdAt_idx" ON "TripPayment"("enrollmentId", "status", "createdAt");
CREATE INDEX "TripPayment_accountId_createdAt_idx" ON "TripPayment"("accountId", "createdAt");

CREATE INDEX "TripBalanceAdjustment_enrollmentId_createdAt_idx" ON "TripBalanceAdjustment"("enrollmentId", "createdAt");
CREATE INDEX "TripBalanceAdjustment_actorAdminId_createdAt_idx" ON "TripBalanceAdjustment"("actorAdminId", "createdAt");

ALTER TABLE "TripDocument"
  ADD CONSTRAINT "TripDocument_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TripAccount"
  ADD CONSTRAINT "TripAccount_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "TripStudent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TripEnrollment"
  ADD CONSTRAINT "TripEnrollment_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TripEnrollment"
  ADD CONSTRAINT "TripEnrollment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "TripStudent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TripEnrollment"
  ADD CONSTRAINT "TripEnrollment_claimedByAccountId_fkey"
  FOREIGN KEY ("claimedByAccountId") REFERENCES "TripAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TripLoginCode"
  ADD CONSTRAINT "TripLoginCode_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TripAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TripPayment"
  ADD CONSTRAINT "TripPayment_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "TripEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TripPayment"
  ADD CONSTRAINT "TripPayment_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TripAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TripBalanceAdjustment"
  ADD CONSTRAINT "TripBalanceAdjustment_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "TripEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
