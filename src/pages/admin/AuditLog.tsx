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

  useEffect(() => {
    adminFetch<AuditResponse>('/api/admin/audit-logs?page=1&pageSize=100').then(setData).catch(console.error);
  }, []);

  if (!data) {
    return <div>Loading audit logs...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-5">Audit Log</h1>
      <div className="space-y-2">
        {data.rows.map((row) => (
          <div key={row.id} className="border border-stone-200 rounded-xl p-3">
            <div className="text-sm font-semibold text-stone-900">{row.action}</div>
            <div className="text-xs text-stone-500">Actor: {row.actor} • {row.entityType} {row.entityId}</div>
            <div className="text-xs text-stone-500">{new Date(row.createdAt).toLocaleString()}</div>
            {row.metadataJson && (
              <pre className="text-[11px] bg-stone-50 border border-stone-200 rounded-lg p-2 mt-2 overflow-auto">
                {JSON.stringify(row.metadataJson, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
