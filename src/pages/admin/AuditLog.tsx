import { useEffect, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type AuditLog = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson?: unknown;
  createdAt: string;
};

type AuditResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: AuditLog[];
};

export default function AdminAuditLogPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetch<AuditResponse>('/api/admin/audit-logs?page=1&pageSize=100');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Audit Log</h1>
        <button
          onClick={() => {
            void load();
          }}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
        >
          Refresh
        </button>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {loading && !data ? <div className="text-sm text-stone-500">Loading audit logs...</div> : null}
      {!loading && data && data.rows.length === 0 ? <div className="text-sm text-stone-500">No audit events found.</div> : null}

      <div className="space-y-2">
        {data?.rows.map((row) => (
          <div key={row.id} className="border border-stone-200 rounded-xl p-3">
            <div className="text-sm font-semibold text-stone-900">{row.action}</div>
            <div className="text-xs text-stone-500">Actor: {row.actor} • {row.entityType} {row.entityId}</div>
            <div className="text-xs text-stone-500">{new Date(row.createdAt).toLocaleString()}</div>
            {row.metadataJson ? (
              <pre className="text-[11px] bg-stone-50 border border-stone-200 rounded-lg p-2 mt-2 overflow-auto">
                {JSON.stringify(row.metadataJson, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
