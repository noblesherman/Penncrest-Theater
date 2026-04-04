-- Admin drive folders/files for CDN hosting and sharing
CREATE TABLE "DriveFolder" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveFolder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveFile" (
  "id" TEXT NOT NULL,
  "folderId" TEXT,
  "displayName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "uploadedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveFolder_parentId_name_key" ON "DriveFolder"("parentId", "name");
CREATE INDEX "DriveFolder_parentId_name_idx" ON "DriveFolder"("parentId", "name");
CREATE INDEX "DriveFolder_createdByAdminId_createdAt_idx" ON "DriveFolder"("createdByAdminId", "createdAt");

CREATE UNIQUE INDEX "DriveFile_objectKey_key" ON "DriveFile"("objectKey");
CREATE INDEX "DriveFile_folderId_createdAt_idx" ON "DriveFile"("folderId", "createdAt");
CREATE INDEX "DriveFile_uploadedByAdminId_createdAt_idx" ON "DriveFile"("uploadedByAdminId", "createdAt");

ALTER TABLE "DriveFolder"
  ADD CONSTRAINT "DriveFolder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "DriveFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveFile"
  ADD CONSTRAINT "DriveFile_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "DriveFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
