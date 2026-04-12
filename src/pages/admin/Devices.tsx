import { FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type CommandType =
  | 'REFRESH_CONFIG'
  | 'RESTART_APP'
  | 'ENTER_MAINTENANCE'
  | 'EXIT_MAINTENANCE'
  | 'UPDATE_APP'
  | 'SET_KIOSK_LOCK';

type CommandStatus = 'PENDING' | 'DELIVERED' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'CANCELED';

type DeviceRow = {
  id: string;
  deviceId: string;
  installationId: string;
  displayName: string | null;
  platform: string;
  model: string | null;
  osVersion: string | null;
  appVersionName: string | null;
  appVersionCode: number | null;
  kioskLocked: boolean;
  maintenanceMode: boolean;
  deviceOwnerActive: boolean;
  updateState: string;
  isOnline: boolean;
  lastHeartbeatAt: string | null;
  lastCommandId: string | null;
  lastCommandStatus: CommandStatus | null;
  lastCommand: {
    id: string;
    type: CommandType;
    status: CommandStatus;
    createdAt: string;
    completedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type DeviceDetailResponse = {
  device: DeviceRow & {
    commands: Array<{
      id: string;
      type: CommandType;
      status: CommandStatus;
      payload: unknown;
      claimTimeoutSeconds: number;
      claimedAt: string | null;
      claimExpiresAt: string | null;
      acknowledgedAt: string | null;
      completedAt: string | null;
      failureReason: string | null;
      createdAt: string;
    }>;
    events: Array<{
      id: string;
      actor: 'ADMIN' | 'DEVICE' | 'SYSTEM';
      actorId: string | null;
      eventType: string;
      metadata: unknown;
      createdAt: string;
    }>;
  };
};

type FleetResponse = {
  release: ReleaseMetadata | null;
  devices: DeviceRow[];
};

type ReleaseMetadata = {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  apkSha256: string;
  apkSizeBytes: number | null;
  forceUpdate: boolean;
  releaseNotes: string | null;
  metadataSignature: string | null;
  updatedAt: string;
};

const commandOptions: Array<{ value: CommandType; label: string }> = [
  { value: 'REFRESH_CONFIG', label: 'Refresh Config' },
  { value: 'RESTART_APP', label: 'Restart App' },
  { value: 'ENTER_MAINTENANCE', label: 'Enter Maintenance' },
  { value: 'EXIT_MAINTENANCE', label: 'Exit Maintenance' },
  { value: 'UPDATE_APP', label: 'Update App' },
  { value: 'SET_KIOSK_LOCK', label: 'Set Kiosk Lock' }
];

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function renderStatusBadge(isOnline: boolean) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export default function AdminDevicesPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<DeviceDetailResponse['device'] | null>(null);
  const [release, setRelease] = useState<ReleaseMetadata | null>(null);

  const [commandType, setCommandType] = useState<CommandType>('REFRESH_CONFIG');
  const [commandPayloadText, setCommandPayloadText] = useState<string>('{}');
  const [settingPin, setSettingPin] = useState<string>('');

  const [releaseForm, setReleaseForm] = useState({
    versionName: '',
    versionCode: '',
    apkUrl: '',
    apkSha256: '',
    apkSizeBytes: '',
    forceUpdate: false,
    releaseNotes: '',
    metadataSignature: ''
  });

  const [loadingFleet, setLoadingFleet] = useState(false);
  const [loadingDevice, setLoadingDevice] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedDeviceSummary = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) || null,
    [devices, selectedDeviceId]
  );

  const hydrateReleaseForm = (nextRelease: ReleaseMetadata | null) => {
    if (!nextRelease) {
      return;
    }

    setReleaseForm({
      versionName: nextRelease.versionName,
      versionCode: String(nextRelease.versionCode),
      apkUrl: nextRelease.apkUrl,
      apkSha256: nextRelease.apkSha256,
      apkSizeBytes: nextRelease.apkSizeBytes ? String(nextRelease.apkSizeBytes) : '',
      forceUpdate: nextRelease.forceUpdate,
      releaseNotes: nextRelease.releaseNotes || '',
      metadataSignature: nextRelease.metadataSignature || ''
    });
  };

  const loadFleet = async () => {
    setLoadingFleet(true);
    setError(null);
    try {
      const response = await adminFetch<FleetResponse>('/api/admin/devices');
      setDevices(response.devices);
      setRelease(response.release);
      hydrateReleaseForm(response.release);

      if (!selectedDeviceId && response.devices.length > 0) {
        setSelectedDeviceId(response.devices[0].id);
      }

      if (selectedDeviceId && !response.devices.some((device) => device.id === selectedDeviceId)) {
        setSelectedDeviceId(response.devices[0]?.id || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load managed devices');
    } finally {
      setLoadingFleet(false);
    }
  };

  const loadDeviceDetail = async (id: string) => {
    if (!id) {
      setSelectedDevice(null);
      return;
    }

    setLoadingDevice(true);
    setError(null);
    try {
      const response = await adminFetch<DeviceDetailResponse>(`/api/admin/devices/${encodeURIComponent(id)}`);
      setSelectedDevice(response.device);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load managed device detail');
      setSelectedDevice(null);
    } finally {
      setLoadingDevice(false);
    }
  };

  useEffect(() => {
    void loadFleet();
    const timer = window.setInterval(() => {
      void loadFleet();
    }, 10_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    void loadDeviceDetail(selectedDeviceId);
  }, [selectedDeviceId]);

  const queueCommand = async (type: CommandType, payload?: unknown) => {
    if (!selectedDeviceId) {
      setError('Select a device first');
      return;
    }

    setBusyAction(true);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/devices/${encodeURIComponent(selectedDeviceId)}/commands`, {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload
        })
      });
      setNotice(`${type} queued`);
      await Promise.all([loadFleet(), loadDeviceDetail(selectedDeviceId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue command');
    } finally {
      setBusyAction(false);
    }
  };

  const submitCustomCommand = async (event: FormEvent) => {
    event.preventDefault();

    let payload: unknown;
    if (!commandPayloadText.trim()) {
      payload = undefined;
    } else {
      try {
        payload = JSON.parse(commandPayloadText);
      } catch {
        setError('Command payload must be valid JSON');
        return;
      }
    }

    if (commandType === 'SET_KIOSK_LOCK' && (typeof payload !== 'object' || payload === null || !('locked' in payload))) {
      payload = { locked: true };
    }

    await queueCommand(commandType, payload);
  };

  const submitPin = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedDeviceId) {
      setError('Select a device first');
      return;
    }

    if (!settingPin.trim()) {
      setError('Enter a PIN first');
      return;
    }

    setBusyAction(true);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/devices/${encodeURIComponent(selectedDeviceId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pin: settingPin.trim() })
      });

      setNotice('Device PIN updated');
      setSettingPin('');
      await loadDeviceDetail(selectedDeviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update PIN');
    } finally {
      setBusyAction(false);
    }
  };

  const submitReleaseMetadata = async (event: FormEvent) => {
    event.preventDefault();

    const versionCode = Number.parseInt(releaseForm.versionCode, 10);
    const apkSizeBytes = releaseForm.apkSizeBytes ? Number.parseInt(releaseForm.apkSizeBytes, 10) : undefined;

    if (!Number.isFinite(versionCode) || versionCode <= 0) {
      setError('Version code must be a positive integer');
      return;
    }

    if (releaseForm.apkSizeBytes && (!Number.isFinite(apkSizeBytes) || apkSizeBytes! <= 0)) {
      setError('APK size must be a positive integer when provided');
      return;
    }

    setBusyAction(true);
    setError(null);
    setNotice(null);

    try {
      const response = await adminFetch<{ release: ReleaseMetadata }>('/api/admin/devices/update-metadata', {
        method: 'PUT',
        body: JSON.stringify({
          versionName: releaseForm.versionName.trim(),
          versionCode,
          apkUrl: releaseForm.apkUrl.trim(),
          apkSha256: releaseForm.apkSha256.trim(),
          apkSizeBytes,
          forceUpdate: releaseForm.forceUpdate,
          releaseNotes: releaseForm.releaseNotes.trim() || undefined,
          metadataSignature: releaseForm.metadataSignature.trim() || undefined
        })
      });

      setRelease(response.release);
      hydrateReleaseForm(response.release);
      setNotice('Release metadata updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update release metadata');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-black tracking-tight text-slate-900" style={{ fontFamily: 'var(--font-sans)' }}>
          Device Control Center
        </h1>
        <p className="text-sm text-slate-500">
          Manage kiosk lock state, maintenance mode, remote commands, and mobile APK release rollout.
        </p>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-[340px,1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Fleet</h2>
            <button
              type="button"
              onClick={() => void loadFleet()}
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
            >
              Refresh
            </button>
          </div>

          {loadingFleet && devices.length === 0 ? (
            <p className="text-sm text-slate-500">Loading devices…</p>
          ) : (
            <div className="space-y-2">
              {devices.map((device) => {
                const selected = device.id === selectedDeviceId;
                return (
                  <button
                    type="button"
                    key={device.id}
                    onClick={() => setSelectedDeviceId(device.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? 'border-slate-400 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{device.displayName || device.deviceId}</p>
                      {renderStatusBadge(device.isOnline)}
                    </div>
                    <p className="truncate text-xs text-slate-500">{device.deviceId}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      v{device.appVersionName || 'unknown'} ({device.appVersionCode ?? '—'})
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {device.maintenanceMode && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          Maintenance
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          device.kioskLocked ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {device.kioskLocked ? 'Kiosk Locked' : 'Unlocked'}
                      </span>
                    </div>
                  </button>
                );
              })}

              {devices.length === 0 && <p className="text-sm text-slate-500">No managed devices registered yet.</p>}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">Selected Device</h2>

            {!selectedDeviceId ? (
              <p className="text-sm text-slate-500">Select a device to view controls.</p>
            ) : loadingDevice && !selectedDevice ? (
              <p className="text-sm text-slate-500">Loading device details…</p>
            ) : selectedDevice ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</p>
                    <div className="mt-1">{renderStatusBadge(selectedDevice.isOnline)}</div>
                    <p className="mt-1 text-xs text-slate-500">Heartbeat: {formatWhen(selectedDevice.lastHeartbeatAt)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Version</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedDevice.appVersionName || 'unknown'} ({selectedDevice.appVersionCode ?? '—'})
                    </p>
                    <p className="text-xs text-slate-500">{selectedDevice.platform}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Kiosk</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{selectedDevice.kioskLocked ? 'Locked' : 'Unlocked'}</p>
                    <p className="text-xs text-slate-500">Device owner: {selectedDevice.deviceOwnerActive ? 'Active' : 'Inactive'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Runtime</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {selectedDevice.maintenanceMode ? 'Maintenance' : 'Production'}
                    </p>
                    <p className="text-xs text-slate-500">Update: {selectedDevice.updateState}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void queueCommand(selectedDevice.maintenanceMode ? 'EXIT_MAINTENANCE' : 'ENTER_MAINTENANCE')}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:border-amber-300 disabled:opacity-60"
                  >
                    {selectedDevice.maintenanceMode ? 'Exit Maintenance' : 'Enter Maintenance'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() =>
                      void queueCommand('SET_KIOSK_LOCK', {
                        locked: !selectedDevice.kioskLocked
                      })
                    }
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:border-indigo-300 disabled:opacity-60"
                  >
                    {selectedDevice.kioskLocked ? 'Unlock Kiosk' : 'Lock Kiosk'}
                  </button>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void queueCommand('UPDATE_APP')}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:border-emerald-300 disabled:opacity-60"
                  >
                    Trigger App Update
                  </button>
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  <form onSubmit={submitCustomCommand} className="space-y-3 rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Queue Command</h3>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Command Type
                      <select
                        value={commandType}
                        onChange={(event) => setCommandType(event.target.value as CommandType)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      >
                        {commandOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Payload JSON
                      <textarea
                        value={commandPayloadText}
                        onChange={(event) => setCommandPayloadText(event.target.value)}
                        rows={6}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      Queue Command
                    </button>
                  </form>

                  <form onSubmit={submitPin} className="space-y-3 rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Admin Escape PIN</h3>
                    <p className="text-xs text-slate-500">Set or rotate the PIN used for temporary admin unlock on this device.</p>
                    <input
                      type="password"
                      value={settingPin}
                      onChange={(event) => setSettingPin(event.target.value)}
                      placeholder="4-16 digits"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                    />
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      Save PIN
                    </button>
                  </form>
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent Commands</h3>
                    <div className="space-y-2">
                      {selectedDevice.commands.map((command) => (
                        <div key={command.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-900">{command.type}</p>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {command.status}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">{formatWhen(command.createdAt)}</p>
                          {command.failureReason && <p className="mt-1 text-[11px] text-rose-600">{command.failureReason}</p>}
                        </div>
                      ))}
                      {selectedDevice.commands.length === 0 && <p className="text-xs text-slate-500">No commands yet.</p>}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-4">
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent Events</h3>
                    <div className="space-y-2">
                      {selectedDevice.events.map((event) => (
                        <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-900">{event.eventType}</p>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {event.actor}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">{formatWhen(event.createdAt)}</p>
                        </div>
                      ))}
                      {selectedDevice.events.length === 0 && <p className="text-xs text-slate-500">No events yet.</p>}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">No device selected.</p>
            )}
          </div>

          <form onSubmit={submitReleaseMetadata} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">APK Release Metadata</h2>
              {release && <p className="text-xs text-slate-500">Last updated: {formatWhen(release.updatedAt)}</p>}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Version Name
                <input
                  value={releaseForm.versionName}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, versionName: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Version Code
                <input
                  value={releaseForm.versionCode}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, versionCode: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  required
                />
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                APK URL
                <input
                  value={releaseForm.apkUrl}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, apkUrl: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  required
                />
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                APK SHA-256
                <input
                  value={releaseForm.apkSha256}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, apkSha256: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900"
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                APK Size (bytes)
                <input
                  value={releaseForm.apkSizeBytes}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, apkSizeBytes: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Metadata Signature
                <input
                  value={releaseForm.metadataSignature}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, metadataSignature: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Release Notes
                <textarea
                  value={releaseForm.releaseNotes}
                  onChange={(event) => setReleaseForm((current) => ({ ...current, releaseNotes: event.target.value }))}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
              </label>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={releaseForm.forceUpdate}
                onChange={(event) => setReleaseForm((current) => ({ ...current, forceUpdate: event.target.checked }))}
              />
              Force update
            </label>

            <div className="mt-4">
              <button
                type="submit"
                disabled={busyAction}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Save Release Metadata
              </button>
            </div>
          </form>
        </section>
      </div>

      {selectedDeviceSummary && (
        <p className="text-xs text-slate-500">
          Selected device: {selectedDeviceSummary.displayName || selectedDeviceSummary.deviceId} ({selectedDeviceSummary.deviceId})
        </p>
      )}
    </div>
  );
}
