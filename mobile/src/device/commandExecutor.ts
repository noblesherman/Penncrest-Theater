import type { ManagedDeviceCommand } from './deviceApi';
import { restartApp, setKioskLock } from '../native/deviceControl';
import type { UpdateCheckResult } from './updateService';

export type CommandExecutionResult = {
  status: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';
  failureReason?: string;
  result?: unknown;
};

type CommandExecutionContext = {
  setMaintenanceMode: (enabled: boolean) => Promise<void>;
  setKioskLocked: (locked: boolean) => Promise<void>;
  runUpdateInstall: () => Promise<UpdateCheckResult>;
};

function commandTimedOut(claimExpiresAt: string | null): boolean {
  if (!claimExpiresAt) {
    return false;
  }

  const expiresAtMs = new Date(claimExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return Date.now() > expiresAtMs;
}

export async function executeManagedDeviceCommand(
  command: ManagedDeviceCommand,
  context: CommandExecutionContext
): Promise<CommandExecutionResult> {
  if (commandTimedOut(command.claimExpiresAt)) {
    return {
      status: 'TIMEOUT',
      failureReason: 'Command claim window expired before execution'
    };
  }

  try {
    switch (command.type) {
      case 'REFRESH_CONFIG': {
        return {
          status: 'SUCCEEDED',
          result: {
            refreshedAt: new Date().toISOString()
          }
        };
      }

      case 'RESTART_APP': {
        await restartApp();
        return {
          status: 'SUCCEEDED',
          result: {
            restartRequested: true
          }
        };
      }

      case 'ENTER_MAINTENANCE': {
        await context.setMaintenanceMode(true);
        return {
          status: 'SUCCEEDED'
        };
      }

      case 'EXIT_MAINTENANCE': {
        await context.setMaintenanceMode(false);
        return {
          status: 'SUCCEEDED'
        };
      }

      case 'UPDATE_APP': {
        const updateResult = await context.runUpdateInstall();
        return {
          status: 'SUCCEEDED',
          result: updateResult
        };
      }

      case 'SET_KIOSK_LOCK': {
        const locked =
          typeof command.payload === 'object' &&
          command.payload !== null &&
          'locked' in command.payload &&
          typeof (command.payload as { locked: unknown }).locked === 'boolean'
            ? (command.payload as { locked: boolean }).locked
            : true;

        const kioskApplied = await setKioskLock(locked);
        if (!kioskApplied) {
          return {
            status: 'FAILED',
            failureReason: 'Kiosk lock policy was not applied (device owner not active or lock task denied)'
          };
        }

        await context.setKioskLocked(locked);

        return {
          status: 'SUCCEEDED',
          result: {
            locked
          }
        };
      }

      default: {
        return {
          status: 'CANCELED',
          failureReason: `Unsupported command type: ${command.type}`
        };
      }
    }
  } catch (error) {
    return {
      status: 'FAILED',
      failureReason: error instanceof Error ? error.message : 'Command execution failed'
    };
  }
}
