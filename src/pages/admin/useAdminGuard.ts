/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/useAdminGuard.ts`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import type { AdminSession } from '../../lib/adminAuth';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAdminToken, ensureAdminSession, getAdminToken } from '../../lib/adminAuth';
import { ApiError } from '../../lib/api';

export function useAdminGuard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState<AdminSession | null>(null);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      navigate('/admin/login', { replace: true });
      return;
    }

    ensureAdminSession()
      .then((session) => {
        setAdmin(session);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearAdminToken();
        }
        navigate('/admin/login', { replace: true });
      });
  }, [navigate]);

  return { loading, admin };
}
