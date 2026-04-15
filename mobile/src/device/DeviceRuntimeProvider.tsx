import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  DEVICE_APP_VERSION_CODE,
  DEVICE_APP_VERSION_NAME,
  DEVICE_COMMAND_POLL_WAIT_MS,
  DEVICE_COMMAND_RETRY_BASE_MS,
  DEVICE_HEARTBEAT_MS
} from '../config';
import {
  acknowledgeManagedDeviceCommand,
  pollNextManagedDeviceCommand,
  registerManagedDevice,
  sendDeviceHeartbeat,
  verifyAdminUnlockPin,
  type DeviceUpdateState,
  type ManagedDeviceCommand
} from './deviceApi';
import { executeManagedDeviceCommand } from './commandExecutor';
import {
  createDeviceIdentity,
  loadPersistedDeviceRuntime,
  savePersistedDeviceRuntime,
  type PersistedDeviceRuntime
} from './deviceStorage';
import { checkForUpdateAndInstall, type UpdateCheckResult } from './updateService';
import { getDeviceInfo, isDeviceOwner, openAppSettings, openWifiSettings, setKioskLock } from '../native/deviceControl';

type DeviceRuntimeState = {
  deviceId: string | null;
  installationId: string | null;
  deviceToken: string | null;
  maintenanceMode: boolean;
  kioskLocked: boolean;
  deviceOwnerActive: boolean;
  updateState: DeviceUpdateState;
  lastCommandId: string | null;
  lastHeartbeatAt: string | null;
};

type AdminUnlockResult = {
  ok: boolean;
  error?: string;
};

type DeviceRuntimeContextValue = {
  state: DeviceRuntimeState;
  isAdminUnlocked: boolean;
  unlockWithPin: (pin: string) => Promise<AdminUnlockResult>;
  relockNow: () => void;
  ensureRegistered: () => Promise<void>;
  checkForUpdateNow: () => Promise<UpdateCheckResult>;
  openWifiSettings: () => Promise<void>;
  openAppSettings: () => Promise<void>;
  setMaintenanceModeLocal: (enabled: boolean) => Promise<void>;
  setKioskLockedLocal: (locked: boolean) => Promise<void>;
};

const DeviceRuntimeContext = createContext<DeviceRuntimeContextValue | null>(null);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const INITIAL_STATE: DeviceRuntimeState = {
  deviceId: null,
  installationId: null,
  deviceToken: null,
  maintenanceMode: false,
  kioskLocked: false,
  deviceOwnerActive: false,
  updateState: 'IDLE',
  lastCommandId: null,
  lastHeartbeatAt: null
};

export function DeviceRuntimeProvider({ children }: PropsWithChildren) {
  const { token: adminToken } = useAuth();
  const [state, setState] = useState<DeviceRuntimeState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [adminUnlockedUntilMs, setAdminUnlockedUntilMs] = useState<number>(0);

  const stateRef = useRef<DeviceRuntimeState>(INITIAL_STATE);
  const registeringRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const persisted = await loadPersistedDeviceRuntime();
      if (cancelled) {
        return;
      }

      if (persisted) {
        setState((current) => ({
          ...current,
          deviceId: persisted.deviceId,
          installationId: persisted.installationId,
          deviceToken: persisted.deviceToken,
          maintenanceMode: persisted.maintenanceMode,
          kioskLocked: persisted.kioskLocked,
          updateState: (persisted.updateState as DeviceUpdateState) || 'IDLE',
          lastCommandId: persisted.lastCommandId
        }));
      } else {
        const identity = createDeviceIdentity();
        setState((current) => ({
          ...current,
          deviceId: identity.deviceId,
          installationId: identity.installationId
        }));
      }

      setHydrated(true);
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !state.deviceId || !state.installationId) {
      return;
    }

    const persisted: PersistedDeviceRuntime = {
      deviceId: state.deviceId,
      installationId: state.installationId,
      deviceToken: state.deviceToken,
      maintenanceMode: state.maintenanceMode,
      kioskLocked: state.kioskLocked,
      updateState: state.updateState,
      lastCommandId: state.lastCommandId
    };

    void savePersistedDeviceRuntime(persisted);
  }, [
    hydrated,
    state.deviceId,
    state.installationId,
    state.deviceToken,
    state.maintenanceMode,
    state.kioskLocked,
    state.updateState,
    state.lastCommandId
  ]);

  const setMaintenanceModeLocal = async (enabled: boolean) => {
    setState((current) => ({
      ...current,
      maintenanceMode: enabled
    }));
  };

  const setKioskLockLocal = async (locked: boolean) => {
    setState((current) => ({
      ...current,
      kioskLocked: locked
    }));
  };

  const checkForUpdateNow = async (): Promise<UpdateCheckResult> => {
    const token = stateRef.current.deviceToken;
    if (!token) {
      throw new Error('Device is not registered yet');
    }

    setState((current) => ({ ...current, updateState: 'DOWNLOADING' }));

    try {
      const result = await checkForUpdateAndInstall({
        deviceToken: token,
        currentVersionCode: DEVICE_APP_VERSION_CODE
      });

      setState((current) => ({
        ...current,
        updateState: result.updateAvailable && result.installAttempted ? (result.installResult?.installed ? 'INSTALLED' : 'FAILED') : 'IDLE'
      }));

      return result;
    } catch (error) {
      setState((current) => ({
        ...current,
        updateState: 'FAILED'
      }));
      throw error;
    }
  };

  const ensureRegistered = async () => {
    if (registeringRef.current) {
      return;
    }

    const current = stateRef.current;
    if (!adminToken || current.deviceToken || !current.deviceId || !current.installationId) {
      return;
    }

    registeringRef.current = true;
    try {
      const deviceInfo = await getDeviceInfo();
      const response = await registerManagedDevice(adminToken, {
        deviceId: current.deviceId,
        installationId: current.installationId,
        displayName: deviceInfo.deviceName || deviceInfo.model,
        platform: 'android',
        model: deviceInfo.model,
        osVersion: deviceInfo.osVersion
      });

      setState((previous) => ({
        ...previous,
        deviceToken: response.deviceToken
      }));
    } catch {
      // Keep background runtime resilient; next successful admin session can re-register.
    } finally {
      registeringRef.current = false;
    }
  };

  useEffect(() => {
    void ensureRegistered();
  }, [adminToken, hydrated]);

  useEffect(() => {
    if (!hydrated || !state.deviceToken || !state.deviceId || !state.installationId) {
      return;
    }

    let cancelled = false;

    const sendHeartbeatOnce = async () => {
      if (cancelled) {
        return;
      }

      try {
        const ownerActive = await isDeviceOwner();
        const response = await sendDeviceHeartbeat(state.deviceToken!, {
          deviceId: state.deviceId!,
          installationId: state.installationId!,
          appVersionName: DEVICE_APP_VERSION_NAME,
          appVersionCode: DEVICE_APP_VERSION_CODE,
          kioskLocked: stateRef.current.kioskLocked,
          maintenanceMode: stateRef.current.maintenanceMode,
          deviceOwnerActive: ownerActive,
          updateState: stateRef.current.updateState,
          lastCommandId: stateRef.current.lastCommandId
        });

        setState((current) => ({
          ...current,
          maintenanceMode: response.state.maintenanceMode,
          kioskLocked: response.state.kioskLocked,
          updateState: response.state.updateState,
          deviceOwnerActive: ownerActive,
          lastHeartbeatAt: response.serverTime
        }));
      } catch {
        // Ignore transient network errors; retry on the next interval.
      }
    };

    void sendHeartbeatOnce();
    const timer = setInterval(() => {
      void sendHeartbeatOnce();
    }, DEVICE_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hydrated, state.deviceToken, state.deviceId, state.installationId]);

  useEffect(() => {
    if (!hydrated || !state.deviceToken) {
      return;
    }

    let cancelled = false;

    const handleCommand = async (command: ManagedDeviceCommand) => {
      const result = await executeManagedDeviceCommand(command, {
        setMaintenanceMode: setMaintenanceModeLocal,
        setKioskLocked: setKioskLockLocal,
        runUpdateInstall: checkForUpdateNow
      });

      try {
        await acknowledgeManagedDeviceCommand(stateRef.current.deviceToken!, command.id, {
          status: result.status,
          failureReason: result.failureReason,
          result: result.result
        });
      } catch {
        // The next command loop iteration will continue normally.
      }

      setState((current) => ({
        ...current,
        lastCommandId: command.id
      }));
    };

    const runLoop = async () => {
      let backoffMs = DEVICE_COMMAND_RETRY_BASE_MS;

      while (!cancelled) {
        const token = stateRef.current.deviceToken;
        if (!token) {
          await wait(backoffMs);
          continue;
        }

        try {
          const response = await pollNextManagedDeviceCommand(token, DEVICE_COMMAND_POLL_WAIT_MS);
          if (response.command) {
            await handleCommand(response.command);
          }
          backoffMs = DEVICE_COMMAND_RETRY_BASE_MS;
        } catch {
          await wait(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 30_000);
        }
      }
    };

    void runLoop();

    return () => {
      cancelled = true;
    };
  }, [hydrated, state.deviceToken]);

  const unlockWithPin = async (pin: string): Promise<AdminUnlockResult> => {
    const token = stateRef.current.deviceToken;
    if (!token) {
      return {
        ok: false,
        error: 'Device is not registered yet'
      };
    }

    try {
      const response = await verifyAdminUnlockPin(token, pin);
      if (!response.ok) {
        return {
          ok: false,
          error: response.lockedUntil ? 'PIN temporarily locked due to too many attempts' : 'Incorrect PIN'
        };
      }

      const unlockWindowSeconds = response.unlockWindowSeconds ?? 300;
      setAdminUnlockedUntilMs(Date.now() + unlockWindowSeconds * 1_000);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 423) {
        return {
          ok: false,
          error: 'PIN temporarily locked due to too many attempts'
        };
      }

      return {
        ok: false,
        error: error instanceof Error ? error.message : 'We could not verify PIN'
      };
    }
  };

  const relockNow = () => {
    setAdminUnlockedUntilMs(0);
  };

  const isAdminUnlocked = adminUnlockedUntilMs > Date.now();

  const value = useMemo<DeviceRuntimeContextValue>(
    () => ({
      state,
      isAdminUnlocked,
      unlockWithPin,
      relockNow,
      ensureRegistered,
      checkForUpdateNow,
      openWifiSettings,
      openAppSettings,
      setMaintenanceModeLocal,
      setKioskLockedLocal: setKioskLockLocal
    }),
    [isAdminUnlocked, state]
  );

  return <DeviceRuntimeContext.Provider value={value}>{children}</DeviceRuntimeContext.Provider>;
}

export function useDeviceRuntime(): DeviceRuntimeContextValue {
  const context = useContext(DeviceRuntimeContext);
  if (!context) {
    throw new Error('useDeviceRuntime must be used within DeviceRuntimeProvider');
  }

  return context;
}

export async function forceRelockKioskFromRuntime(): Promise<void> {
  await setKioskLock(true);
}
