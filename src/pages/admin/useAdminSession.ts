import { useOutletContext } from 'react-router-dom';
import type { AdminSession } from '../../lib/adminAuth';

export type AdminLayoutContext = {
  admin: AdminSession;
};

export function useAdminSession(): AdminLayoutContext {
  return useOutletContext<AdminLayoutContext>();
}
