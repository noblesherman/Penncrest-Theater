import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearAdminToken, ensureAdminSession, getAdminToken } from '../../lib/adminAuth';

export function useAdminGuard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      navigate('/admin/login', { replace: true });
      return;
    }

    ensureAdminSession()
      .then(() => setLoading(false))
      .catch(() => {
        clearAdminToken();
        navigate('/admin/login', { replace: true });
      });
  }, [navigate]);

  return { loading };
}
