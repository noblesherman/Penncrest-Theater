/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Drive.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Link2,
  MoveRight,
  Pencil,
  QrCode,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';
import { toQrCodeDataUrl } from '../../lib/qrCode';

type DriveFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    children: number;
    files: number;
  };
};

type DriveFile = {
  id: string;
  folderId: string | null;
  displayName: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

type DriveResponse = {
  currentFolder: DriveFolder | null;
  breadcrumbs: Array<{ id: string | null; name: string }>;
  folders: DriveFolder[];
  files: DriveFile[];
  tree: DriveFolder[];
  upload: {
    enabled: boolean;
    maxBytes: number;
  };
};

type QrTarget = {
  id: string;
  displayName: string;
  publicUrl: string;
};

const ROOT_FOLDER_KEY = '__root__';
const driveEase = [0.22, 1, 0.36, 1] as const;
const panelClass =
  'rounded-3xl border border-stone-200 bg-white shadow-[0_18px_50px_-42px_rgba(28,25,23,0.55)]';
const softButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-700 transition hover:-translate-y-0.5 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-stone-950 bg-stone-950 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5 hover:border-stone-800 hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-200 disabled:cursor-not-allowed disabled:opacity-50';
const iconButtonClass =
  'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 transition hover:-translate-y-0.5 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950 focus:outline-none focus:ring-2 focus:ring-rose-200';
const dangerButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-700 transition hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('We hit a small backstage snag while trying to read file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('We hit a small backstage snag while trying to parse file.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function sanitizeDownloadName(filename: string): string {
  return (
    filename
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'file'
  );
}

function buildFolderPathMap(tree: DriveFolder[]): Map<string, string> {
  const folderById = new Map<string, DriveFolder>();
  tree.forEach((folder) => {
    folderById.set(folder.id, folder);
  });

  const cache = new Map<string, string>();

  const resolve = (folderId: string, visited = new Set<string>()): string => {
    if (cache.has(folderId)) {
      return cache.get(folderId)!;
    }

    if (visited.has(folderId)) {
      return folderById.get(folderId)?.name || folderId;
    }

    visited.add(folderId);

    const folder = folderById.get(folderId);
    if (!folder) {
      return folderId;
    }

    const path = folder.parentId ? `${resolve(folder.parentId, visited)} / ${folder.name}` : folder.name;
    cache.set(folderId, path);
    return path;
  };

  tree.forEach((folder) => {
    resolve(folder.id);
  });

  return cache;
}

function DriveStat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof File }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-xl font-black tracking-tight text-stone-950">{value}</div>
    </div>
  );
}

export default function AdminDrivePage() {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [state, setState] = useState<DriveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [qrTarget, setQrTarget] = useState<QrTarget | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  async function loadDrive(folderId = currentFolderId): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      const payload = await adminFetch<DriveResponse>(`/api/admin/drive${query}`);
      setState(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load drive');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDrive(currentFolderId);
  }, [currentFolderId]);

  const folderPathMap = useMemo(() => buildFolderPathMap(state?.tree || []), [state?.tree]);

  const treeByParent = useMemo(() => {
    const map = new Map<string, DriveFolder[]>();

    (state?.tree || []).forEach((folder) => {
      const key = folder.parentId || ROOT_FOLDER_KEY;
      const list = map.get(key) || [];
      list.push(folder);
      map.set(key, list);
    });

    map.forEach((folders, key) => {
      map.set(
        key,
        folders.slice().sort((a, b) => a.name.localeCompare(b.name))
      );
    });

    return map;
  }, [state?.tree]);

  const folderOptions = useMemo(() => {
    const folders = (state?.tree || []).map((folder) => ({
      id: folder.id,
      label: folderPathMap.get(folder.id) || folder.name
    }));

    return folders.sort((a, b) => a.label.localeCompare(b.label));
  }, [folderPathMap, state?.tree]);

  const currentFolderBytes = useMemo(
    () => (state?.files || []).reduce((total, file) => total + file.sizeBytes, 0),
    [state?.files]
  );

  const currentFolderLabel = state?.currentFolder?.name || 'Drive Root';

  async function handleCreateFolder(event: FormEvent) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;

    setError(null);
    setNotice(null);

    try {
      await adminFetch('/api/admin/drive/folders', {
        method: 'POST',
        body: JSON.stringify({
          name,
          parentId: currentFolderId
        })
      });

      setNewFolderName('');
      setNotice('Folder created.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to create folder');
    }
  }

  async function handleRenameCurrentFolder() {
    if (!state?.currentFolder) return;

    const nextName = window.prompt('Rename folder', state.currentFolder.name);
    if (!nextName) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === state.currentFolder.name) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/drive/folders/${encodeURIComponent(state.currentFolder.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmed
        })
      });

      setNotice('Folder renamed.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to rename folder');
    }
  }

  async function handleDeleteCurrentFolder() {
    if (!state?.currentFolder) return;

    const confirmed = window.confirm(`Delete folder "${state.currentFolder.name}"? It must be empty first.`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);

    try {
      const parentId = state.currentFolder.parentId;
      await adminFetch(`/api/admin/drive/folders/${encodeURIComponent(state.currentFolder.id)}`, {
        method: 'DELETE'
      });

      setCurrentFolderId(parentId);
      setNotice('Folder deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete folder');
    }
  }

  async function handleUploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !state) {
      return;
    }

    if (!state.upload.enabled) {
      setError('R2/CDN is not configured. Uploads are unavailable.');
      return;
    }

    if (file.size > state.upload.maxBytes) {
      setError(`File too large. Max upload size is ${formatBytes(state.upload.maxBytes)}.`);
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const dataUrl = await fileToDataUrl(file);
      await adminFetch('/api/admin/drive/files/upload', {
        method: 'POST',
        body: JSON.stringify({
          folderId: currentFolderId,
          filename: file.name,
          dataUrl
        })
      });

      setNotice('File uploaded to CDN.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to upload file');
    } finally {
      setUploading(false);
    }
  }

  async function handleCopyLink(file: DriveFile) {
    setError(null);
    setNotice(null);

    try {
      await navigator.clipboard.writeText(file.publicUrl);
      setNotice('Public link copied.');
    } catch {
      setError('Clipboard is blocked. Copy the URL manually.');
    }
  }

  async function handleDeleteFile(file: DriveFile) {
    const confirmed = window.confirm(`Delete file "${file.displayName}"?`);
    if (!confirmed) return;

    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/drive/files/${encodeURIComponent(file.id)}`, {
        method: 'DELETE'
      });

      if (qrTarget?.id === file.id) {
        setQrTarget(null);
        setQrDataUrl(null);
      }

      setNotice('File deleted.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete file');
    }
  }

  async function handleRenameFile(file: DriveFile) {
    const nextName = window.prompt('Rename file', file.displayName);
    if (!nextName) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === file.displayName) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/drive/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: trimmed
        })
      });

      setNotice('File renamed.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to rename file');
    }
  }

  async function handleMoveFile(file: DriveFile, nextFolderId: string | null) {
    if (file.folderId === nextFolderId) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/drive/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          folderId: nextFolderId
        })
      });

      setNotice('File moved.');
      await loadDrive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to move file');
    }
  }

  async function handleGenerateQr(file: DriveFile) {
    setQrLoading(true);
    setError(null);

    try {
      const dataUrl = await toQrCodeDataUrl(file.publicUrl, 360);
      setQrTarget({
        id: file.id,
        displayName: file.displayName,
        publicUrl: file.publicUrl
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to generate QR code');
    } finally {
      setQrLoading(false);
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl || !qrTarget) return;

    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${sanitizeDownloadName(qrTarget.displayName)}-qr.png`;
    link.click();
  }

  function renderFolderTree(parentId: string | null, depth = 0): ReactNode {
    const key = parentId || ROOT_FOLDER_KEY;
    const folders = treeByParent.get(key) || [];
    if (folders.length === 0) {
      return null;
    }

    return (
      <div className="space-y-1">
        {folders.map((folder) => {
          const active = folder.id === currentFolderId;

          return (
            <div key={folder.id}>
              <button
                type="button"
                onClick={() => setCurrentFolderId(folder.id)}
                className={`group flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition ${
                  active
                    ? 'bg-stone-950 text-white shadow-sm'
                    : 'text-stone-600 hover:bg-stone-100 hover:text-stone-950'
                }`}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
              >
                {active ? (
                  <FolderOpen className="h-4 w-4 text-amber-300" />
                ) : (
                  <Folder className="h-4 w-4 text-stone-400 group-hover:text-amber-600" />
                )}
                <span className="truncate">{folder.name}</span>
                <span
                  className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? 'bg-white/10 text-stone-200' : 'bg-stone-200/70 text-stone-500'
                  }`}
                >
                  {folder._count.files}
                </span>
              </button>
              {renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 text-stone-900">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: driveEase }}
        className={`${panelClass} relative overflow-hidden p-5 sm:p-6`}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#e11d48,#f59e0b,#0f766e)]" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-black tracking-tight text-stone-950 sm:text-4xl">Drive</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">
              Keep show files, sponsor assets, QR links, and public downloads tidy for the team.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void loadDrive()} className={softButtonClass}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <label className={`${primaryButtonClass} cursor-pointer`}>
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Uploading' : 'Upload'}
              <input
                type="file"
                className="hidden"
                disabled={uploading || !state?.upload.enabled}
                onChange={(event) => void handleUploadFile(event)}
              />
            </label>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DriveStat label="Current files" value={String(state?.files.length || 0)} icon={File} />
          <DriveStat label="Folders here" value={String(state?.folders.length || 0)} icon={FolderOpen} />
          <DriveStat label="Storage here" value={state ? formatBytes(currentFolderBytes) : '...'} icon={HardDrive} />
          <DriveStat label="Upload cap" value={state ? formatBytes(state.upload.maxBytes) : '...'} icon={FileUp} />
        </div>
      </motion.header>

      <AnimatePresence>
        {error ? (
          <motion.div
            key="drive-error"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: driveEase }}
            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
          >
            {error}
          </motion.div>
        ) : null}

        {notice ? (
          <motion.div
            key="drive-notice"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: driveEase }}
            className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"
          >
            {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <motion.aside
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, duration: 0.36, ease: driveEase }}
          className={`${panelClass} self-start p-4 xl:sticky xl:top-5 xl:col-span-4`}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black tracking-tight text-stone-950">Folders</h2>
              <p className="mt-0.5 text-xs text-stone-400">{state?.tree.length || 0} total folders</p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentFolderId(null)}
              className={`rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] transition ${
                currentFolderId === null
                  ? 'bg-stone-950 text-white'
                  : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-950'
              }`}
            >
              Root
            </button>
          </div>

          <form onSubmit={handleCreateFolder} className="mb-4 flex items-center gap-2">
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="New folder"
              className="h-10 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm font-medium text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-rose-300 focus:bg-white focus:ring-2 focus:ring-rose-100"
            />
            <button type="submit" className={iconButtonClass} aria-label="Create folder">
              <FolderPlus className="h-4 w-4" />
            </button>
          </form>

          <div className="max-h-[520px] overflow-y-auto pr-1">
            {loading && !state ? (
              <p className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
                Loading folders...
              </p>
            ) : (
              renderFolderTree(null) || (
                <p className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500">
                  No folders yet.
                </p>
              )
            )}
          </div>
        </motion.aside>

        <main className="space-y-5 xl:col-span-8">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.38, ease: driveEase }}
            className={`${panelClass} overflow-hidden`}
          >
            <div className="border-b border-stone-100 p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-400">Current folder</p>
                      <h2 className="mt-0.5 truncate text-2xl font-black tracking-tight text-stone-950">
                        {currentFolderLabel}
                      </h2>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-stone-500">
                    {state?.breadcrumbs.map((crumb, index) => (
                      <span key={`${crumb.id || 'root'}-${index}`} className="inline-flex items-center gap-1">
                        {index > 0 ? <ChevronRight className="h-3 w-3 text-stone-300" /> : null}
                        <button
                          type="button"
                          onClick={() => setCurrentFolderId(crumb.id)}
                          className="rounded-lg px-2 py-1 transition hover:bg-stone-100 hover:text-stone-950"
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {state?.currentFolder ? (
                    <>
                      <button type="button" onClick={() => void handleRenameCurrentFolder()} className={softButtonClass}>
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </button>
                      <button type="button" onClick={() => void handleDeleteCurrentFolder()} className={dangerButtonClass}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-500">
                <HardDrive className="h-3.5 w-3.5" />
                Max upload size: {state ? formatBytes(state.upload.maxBytes) : '...'}
                {state?.upload.enabled ? null : ' · R2/CDN not configured'}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black tracking-tight text-stone-950">Subfolders</h3>
                <span className="text-xs font-semibold text-stone-400">{state?.folders.length || 0} in view</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <AnimatePresence initial={false}>
                  {state?.folders.length ? (
                    state.folders.map((folder, index) => (
                      <motion.button
                        key={folder.id}
                        type="button"
                        onClick={() => setCurrentFolderId(folder.id)}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ delay: index * 0.025, duration: 0.24, ease: driveEase }}
                        className="group flex w-full items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-amber-200 hover:bg-amber-50/70"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm ring-1 ring-stone-200 transition group-hover:ring-amber-200">
                          <FolderOpen className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-stone-950">{folder.name}</div>
                          <div className="text-xs text-stone-500">
                            {folder._count.children} folders · {folder._count.files} files
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-amber-600" />
                      </motion.button>
                    ))
                  ) : (
                    <motion.div
                      key="empty-folders"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="rounded-2xl border border-dashed border-stone-200 p-4 text-sm text-stone-500 sm:col-span-2"
                    >
                      No subfolders in this location.
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.38, ease: driveEase }}
            className={`${panelClass} p-4 sm:p-5`}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-tight text-stone-950">Files</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {state?.files.length || 0} files · {state ? formatBytes(currentFolderBytes) : '...'} in this folder
                </p>
              </div>
              {uploading ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-amber-800">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Uploading
                </span>
              ) : null}
            </div>

            {loading && !state ? <p className="text-sm text-stone-500">Loading files...</p> : null}

            {state && state.files.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 p-6 text-sm text-stone-500">
                No files uploaded in this folder yet.
              </div>
            ) : null}

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {state?.files.map((file, index) => (
                  <motion.div
                    key={file.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ delay: index * 0.025, duration: 0.24, ease: driveEase }}
                    className="group rounded-2xl border border-stone-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                          <File className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-stone-950">{file.displayName}</div>
                          <div className="mt-0.5 text-xs text-stone-500">
                            {file.mimeType} · {formatBytes(file.sizeBytes)} · Uploaded {formatDateTime(file.createdAt)}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button type="button" onClick={() => void handleCopyLink(file)} className={softButtonClass}>
                          <Link2 className="h-3.5 w-3.5" />
                          Copy
                        </button>
                        <a href={file.publicUrl} target="_blank" rel="noreferrer" className={softButtonClass}>
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </a>
                        <button type="button" onClick={() => void handleGenerateQr(file)} className={softButtonClass}>
                          <QrCode className="h-3.5 w-3.5" />
                          QR
                        </button>
                        <button type="button" onClick={() => void handleRenameFile(file)} className={softButtonClass}>
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </button>
                        <button type="button" onClick={() => void handleDeleteFile(file)} className={dangerButtonClass}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3 text-xs sm:flex-row sm:items-center">
                      <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.12em] text-stone-400">
                        <MoveRight className="h-3.5 w-3.5" />
                        Move to
                      </span>
                      <select
                        value={file.folderId || ''}
                        onChange={(event) => {
                          const nextFolderId = event.target.value || null;
                          void handleMoveFile(file, nextFolderId);
                        }}
                        className="h-9 min-w-0 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-700 outline-none transition focus:border-rose-300 focus:bg-white focus:ring-2 focus:ring-rose-100 sm:min-w-[220px]"
                      >
                        <option value="">Drive Root</option>
                        {folderOptions.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.38, ease: driveEase }}
            className={`${panelClass} overflow-hidden`}
          >
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 ring-1 ring-rose-100">
                    <QrCode className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black tracking-tight text-stone-950">QR Generator</h2>
                    <p className="mt-1 text-sm text-stone-500">Select a file, generate a code, then download the PNG.</p>
                  </div>
                </div>

                <div className="mt-5">
                  {qrLoading ? (
                    <p className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1.5 text-sm font-semibold text-stone-500">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Generating QR code...
                    </p>
                  ) : null}
                  {!qrLoading && !qrTarget ? (
                    <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 p-4 text-sm text-stone-500">
                      No QR selected yet.
                    </p>
                  ) : null}
                  {qrTarget && qrDataUrl ? (
                    <div className="space-y-3">
                      <div className="text-sm font-bold text-stone-950">{qrTarget.displayName}</div>
                      <a
                        href={qrTarget.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all text-xs font-semibold leading-5 text-teal-700 underline decoration-teal-200 underline-offset-4"
                      >
                        {qrTarget.publicUrl}
                      </a>
                      <button type="button" onClick={handleDownloadQr} className={softButtonClass}>
                        <Download className="h-3.5 w-3.5" />
                        Download PNG
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-center border-t border-stone-100 bg-stone-50/70 p-5 lg:border-l lg:border-t-0">
                {qrTarget && qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${qrTarget.displayName}`}
                    className="h-52 w-52 rounded-3xl border border-stone-200 bg-white p-3 shadow-sm"
                  />
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center rounded-3xl border border-dashed border-stone-200 bg-white text-stone-300">
                    <QrCode className="h-12 w-12" />
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        </main>
      </div>
    </div>
  );
}
