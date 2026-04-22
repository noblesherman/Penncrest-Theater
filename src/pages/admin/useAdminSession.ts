/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/useAdminSession.ts`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useOutletContext } from 'react-router-dom';
import type { AdminSession } from '../../lib/adminAuth';

export type AdminLayoutContext = {
  admin: AdminSession;
};

export function useAdminSession(): AdminLayoutContext {
  return useOutletContext<AdminLayoutContext>();
}
