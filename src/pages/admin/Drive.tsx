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
import {
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
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
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${
                  active ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
                style={{ paddingLeft: `${8 + depth * 16}px` }}
              >
                {active ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                <span className="truncate">{folder.name}</span>
                <span className={`ml-auto text-[10px] ${active ? 'text-zinc-200' : 'text-zinc-500'}`}>
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
    <div className="space-y-6">
      <header className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Admin Drive</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-zinc-900">CDN file hosting + share links</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Upload files, organize folders, copy public links, and generate downloadable QR codes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadDrive()}
            className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-300/70 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-300/70 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <aside className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.3)] xl:col-span-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Folders</h2>
            <button
              type="button"
              onClick={() => setCurrentFolderId(null)}
              className={`rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                currentFolderId === null ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'
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
              className="h-9 w-full rounded-lg border border-black/[0.1] px-3 text-sm"
            />
            <button
              type="submit"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/[0.08] px-3 text-sm font-semibold text-zinc-700 hover:border-zinc-300"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </form>

          <div className="max-h-[420px] overflow-y-auto pr-1">
            {loading && !state ? <p className="text-sm text-zinc-500">Loading folders...</p> : renderFolderTree(null)}
          </div>
        </aside>

        <main className="space-y-4 xl:col-span-8">
          <section className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.3)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Current Folder</div>
                <div className="mt-1 text-lg font-bold text-zinc-900">{state?.currentFolder?.name || 'Drive Root'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                  {state?.breadcrumbs.map((crumb, index) => (
                    <button
                      type="button"
                      key={`${crumb.id || 'root'}-${index}`}
                      onClick={() => setCurrentFolderId(crumb.id)}
                      className="rounded px-1 py-0.5 hover:bg-zinc-100"
                    >
                      {index > 0 ? '/ ' : ''}
                      {crumb.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading...' : 'Upload File'}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading || !state?.upload.enabled}
                    onChange={(event) => void handleUploadFile(event)}
                  />
                </label>

                {state?.currentFolder ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRenameCurrentFolder()}
                      className="inline-flex items-center gap-1 rounded-xl border border-black/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteCurrentFolder()}
                      className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-700 hover:border-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mb-4 text-xs text-zinc-500">
              Max upload size: {state ? formatBytes(state.upload.maxBytes) : '...'}
              {state?.upload.enabled ? null : ' (R2/CDN not configured)'}
            </div>

            <div className="space-y-2">
              {state?.folders.length ? (
                state.folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setCurrentFolderId(folder.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3 text-left hover:bg-zinc-100"
                  >
                    <FolderOpen className="h-4 w-4 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-900">{folder.name}</div>
                      <div className="text-xs text-zinc-500">
                        {folder._count.children} folders • {folder._count.files} files
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-black/[0.12] p-3 text-sm text-zinc-500">
                  No subfolders in this location.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.3)]">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Files</h2>

            {loading && !state ? <p className="text-sm text-zinc-500">Loading files...</p> : null}

            {state && state.files.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/[0.12] p-4 text-sm text-zinc-500">
                No files uploaded in this folder yet.
              </div>
            ) : null}

            <div className="space-y-2">
              {state?.files.map((file) => (
                <div key={file.id} className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">{file.displayName}</div>
                      <div className="text-xs text-zinc-500">
                        {file.mimeType} • {formatBytes(file.sizeBytes)} • Uploaded {formatDateTime(file.createdAt)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleCopyLink(file)}
                        className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Copy Link
                      </button>
                      <a
                        href={file.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleGenerateQr(file)}
                        className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        QR
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRenameFile(file)}
                        className="inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFile(file)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-700 hover:border-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wide text-zinc-500">Move To</span>
                    <select
                      value={file.folderId || ''}
                      onChange={(event) => {
                        const nextFolderId = event.target.value || null;
                        void handleMoveFile(file, nextFolderId);
                      }}
                      className="h-8 rounded-lg border border-black/[0.1] px-2 text-xs"
                    >
                      <option value="">Drive Root</option>
                      {folderOptions.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-black/[0.08] bg-white p-4 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.3)]">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">QR Generator</h2>
            {qrLoading ? <p className="text-sm text-zinc-500">Generating QR code...</p> : null}
            {!qrLoading && !qrTarget ? (
              <p className="text-sm text-zinc-500">Select any file and click QR to generate.</p>
            ) : null}
            {qrTarget && qrDataUrl ? (
              <div className="flex flex-wrap items-start gap-4">
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${qrTarget.displayName}`}
                  className="h-48 w-48 rounded-xl border border-black/[0.1] bg-white p-2"
                />
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-zinc-900">{qrTarget.displayName}</div>
                  <a href={qrTarget.publicUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-sky-700 underline">
                    {qrTarget.publicUrl}
                  </a>
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-700 hover:border-zinc-300"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download QR PNG
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}
