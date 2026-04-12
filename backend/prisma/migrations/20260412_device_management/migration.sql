DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ManagedDeviceUpdateState'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "ManagedDeviceUpdateState" AS ENUM (
      'IDLE',
      'DOWNLOADING',
      'VERIFYING',
      'INSTALLING',
      'INSTALLED',
      'FAILED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ManagedDeviceCommandType'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "ManagedDeviceCommandType" AS ENUM (
      'REFRESH_CONFIG',
      'RESTART_APP',
      'ENTER_MAINTENANCE',
      'EXIT_MAINTENANCE',
      'UPDATE_APP',
      'SET_KIOSK_LOCK'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ManagedDeviceCommandStatus'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "ManagedDeviceCommandStatus" AS ENUM (
      'PENDING',
      'DELIVERED',
      'SUCCEEDED',
      'FAILED',
      'TIMEOUT',
      'CANCELED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'ManagedDeviceEventActor'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "ManagedDeviceEventActor" AS ENUM (
      'ADMIN',
      'DEVICE',
      'SYSTEM'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ManagedDevice" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "displayName" TEXT,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "model" TEXT,
  "osVersion" TEXT,
  "tokenVersion" INTEGER NOT NULL DEFAULT 1,
  "lastHeartbeatAt" TIMESTAMP(3),
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "appVersionName" TEXT,
  "appVersionCode" INTEGER,
  "kioskLocked" BOOLEAN NOT NULL DEFAULT false,
  "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
  "deviceOwnerActive" BOOLEAN NOT NULL DEFAULT false,
  "updateState" "ManagedDeviceUpdateState" NOT NULL DEFAULT 'IDLE',
  "lastCommandId" TEXT,
  "lastCommandStatus" "ManagedDeviceCommandStatus",
  "adminPinHash" TEXT,
  "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  "pinLockedUntil" TIMESTAMP(3),
  "registeredByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ManagedDevice_deviceId_key"
  ON "ManagedDevice"("deviceId");
CREATE INDEX IF NOT EXISTS "ManagedDevice_isOnline_lastHeartbeatAt_idx"
  ON "ManagedDevice"("isOnline", "lastHeartbeatAt");
CREATE INDEX IF NOT EXISTS "ManagedDevice_maintenanceMode_kioskLocked_idx"
  ON "ManagedDevice"("maintenanceMode", "kioskLocked");

CREATE TABLE IF NOT EXISTS "ManagedDeviceCommand" (
  "id" TEXT NOT NULL,
  "managedDeviceId" TEXT NOT NULL,
  "type" "ManagedDeviceCommandType" NOT NULL,
  "status" "ManagedDeviceCommandStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "createdByAdminId" TEXT,
  "claimTimeoutSeconds" INTEGER NOT NULL DEFAULT 90,
  "claimedAt" TIMESTAMP(3),
  "claimExpiresAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "result" JSONB,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedDeviceCommand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedDeviceCommand_managedDeviceId_fkey"
    FOREIGN KEY ("managedDeviceId") REFERENCES "ManagedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ManagedDeviceCommand_managedDeviceId_status_createdAt_idx"
  ON "ManagedDeviceCommand"("managedDeviceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ManagedDeviceCommand_status_claimExpiresAt_idx"
  ON "ManagedDeviceCommand"("status", "claimExpiresAt");

CREATE TABLE IF NOT EXISTS "MobileAppRelease" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'production',
  "versionName" TEXT NOT NULL,
  "versionCode" INTEGER NOT NULL,
  "apkUrl" TEXT NOT NULL,
  "apkSha256" TEXT NOT NULL,
  "apkSizeBytes" INTEGER,
  "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
  "releaseNotes" TEXT,
  "metadataSignature" TEXT,
  "createdByAdminId" TEXT,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobileAppRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileAppRelease_channel_key"
  ON "MobileAppRelease"("channel");
CREATE INDEX IF NOT EXISTS "MobileAppRelease_versionCode_idx"
  ON "MobileAppRelease"("versionCode");

CREATE TABLE IF NOT EXISTS "ManagedDeviceEvent" (
  "id" TEXT NOT NULL,
  "managedDeviceId" TEXT NOT NULL,
  "actor" "ManagedDeviceEventActor" NOT NULL DEFAULT 'SYSTEM',
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedDeviceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManagedDeviceEvent_managedDeviceId_fkey"
    FOREIGN KEY ("managedDeviceId") REFERENCES "ManagedDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ManagedDeviceEvent_managedDeviceId_createdAt_idx"
  ON "ManagedDeviceEvent"("managedDeviceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ManagedDeviceEvent_eventType_createdAt_idx"
  ON "ManagedDeviceEvent"("eventType", "createdAt");
