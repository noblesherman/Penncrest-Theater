import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, apiUrl } from '../lib/api';
import { clearStaffToken, getStaffToken, setStaffToken, staffFetch } from '../lib/staffAuth';

type StaffUser = {
  id: string;
  email: string;
  name: string;
  authProvider: 'GOOGLE' | 'MICROSOFT' | 'LOCAL';
  verifiedStaff: boolean;
  staffVerifyMethod: 'OAUTH_GOOGLE' | 'OAUTH_MICROSOFT' | 'REDEEM_CODE' | null;
  staffVerifiedAt: string | null;
};

type Performance = {
  id: string;
  title: string;
  startsAt: string;
  salesOpen: boolean;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
};

type Seat = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean;
  isCompanion?: boolean;
};

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function buildSeatGrid(seats: Seat[]) {
  const grid: Record<string, Record<string, Seat[]>> = {};

  seats.forEach((seat) => {
    if (!grid[seat.sectionName]) grid[seat.sectionName] = {};
    if (!grid[seat.sectionName][seat.row]) grid[seat.sectionName][seat.row] = [];
    grid[seat.sectionName][seat.row].push(seat);
  });

  Object.keys(grid).forEach((section) => {
    Object.keys(grid[section]).forEach((row) => {
      grid[section][row].sort((a, b) => a.number - b.number);
    });
  });

  return grid;
}

function oauthErrorMessage(errorParam: string | null): string | null {
  if (!errorParam) return null;
  if (errorParam === 'oauth_failed') return 'OAuth sign in failed. Please try again.';
  if (errorParam === 'access_denied') return 'Sign in was cancelled.';
  return decodeURIComponent(errorParam).replace(/\+/g, ' ');
}

export default function StaffTicketsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [user, setUser] = useState<StaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [error, setError] = useState<string | null>(oauthErrorMessage(searchParams.get('error')));
  const [submitting, setSubmitting] = useState(false);

  const [localName, setLocalName] = useState('');
  const [localEmail, setLocalEmail] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [teacherPromoCode, setTeacherPromoCode] = useState('');

  const [performances, setPerformances] = useState<Performance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatId, setSeatId] = useState('');
  const [attendeeName, setAttendeeName] = useState('');

  const availableSeats = useMemo(
    () =>
      seats
        .filter((seat) => seat.status === 'available' && !seat.isCompanion)
        .sort((a, b) => {
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
          return a.number - b.number;
        }),
    [seats]
  );

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === performanceId) || null,
    [performanceId, performances]
  );
  const selectedSeat = useMemo(() => seats.find((seat) => seat.id === seatId) || null, [seatId, seats]);
  const seatGrid = useMemo(() => buildSeatGrid(seats), [seats]);
  const sections = useMemo(() => Object.keys(seatGrid).sort(naturalSort), [seatGrid]);
  const oauthReturnTo = location.pathname;
  const googleOAuthStartUrl = apiUrl(`/auth/google/start?${new URLSearchParams({ returnTo: oauthReturnTo }).toString()}`);
  const microsoftOAuthStartUrl = apiUrl(
    `/auth/microsoft/start?${new URLSearchParams({ returnTo: oauthReturnTo }).toString()}`
  );

  const syncUser = async () => {
    const token = getStaffToken();
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }

    try {
      const me = await staffFetch<{ user: StaffUser }>('/auth/staff/me');
      setUser(me.user);
    } catch {
      clearStaffToken();
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    const oauthToken = searchParams.get('authToken');
    if (oauthToken) {
      setStaffToken(oauthToken);
      const next = new URLSearchParams(searchParams);
      next.delete('authToken');
      next.delete('error');
      setSearchParams(next, { replace: true });
    }

    void syncUser();
  }, []);

  useEffect(() => {
    if (!user?.verifiedStaff) {
      setPerformances([]);
      setPerformanceId('');
      return;
    }

    apiFetch<Performance[]>('/api/performances')
      .then((rows) => {
        const eligible = rows.filter((row) => row.salesOpen && row.staffCompsEnabled);
        setPerformances(eligible);
        if (eligible.length > 0) {
          setPerformanceId((prev) => (prev && eligible.some((item) => item.id === prev) ? prev : eligible[0].id));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  }, [user?.id, user?.verifiedStaff]);

  useEffect(() => {
    if (!performanceId || !user?.verifiedStaff) {
      setSeats([]);
      setSeatId('');
      return;
    }

    apiFetch<Seat[]>(`/api/performances/${performanceId}/seats`)
      .then((rows) => {
        setSeats(rows);
        setSeatId((previousSeatId) => {
          const stillAvailable = rows.some(
            (seat) => seat.id === previousSeatId && seat.status === 'available' && !seat.isCompanion
          );
          if (stillAvailable) return previousSeatId;
          return rows.find((seat) => seat.status === 'available' && !seat.isCompanion)?.id || '';
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load seats'));
  }, [performanceId, user?.verifiedStaff]);

  const startLocalSession = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await apiFetch<{ token: string; user: StaffUser }>('/auth/staff/local-session', {
        method: 'POST',
        body: JSON.stringify({
          name: localName,
          email: localEmail
        })
      });

      setStaffToken(result.token);
      setUser(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start local session');
    } finally {
      setSubmitting(false);
    }
  };

  const redeemStaffCode = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await staffFetch<{ token: string; user: StaffUser }>('/staff/redeem-code', {
        method: 'POST',
        body: JSON.stringify({ code: redeemCode })
      });

      setStaffToken(result.token);
      setUser(result.user);
      setRedeemCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to redeem code');
    } finally {
      setSubmitting(false);
    }
  };

  const reserveCompTicket = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await staffFetch<{ orderId: string }>('/tickets/staff-comp/reserve', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatId,
          teacherPromoCode,
          attendeeName: attendeeName.trim() || undefined
        })
      });

      navigate(`/confirmation?orderId=${result.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reserve staff comp ticket');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <div className="min-h-screen bg-stone-50 flex items-center justify-center">Loading staff session...</div>;
  }

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <h1 className="mb-2 text-2xl font-black text-stone-900 sm:text-3xl">Teacher Complimentary Ticket</h1>
        <p className="text-stone-600 mb-6">Verified teachers and theater staff can reserve complimentary tickets online.</p>

        {!user ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <a href={googleOAuthStartUrl} className="rounded-xl bg-stone-900 px-5 py-3 text-center font-bold text-white">
                Sign in with Google
              </a>
              <a href={microsoftOAuthStartUrl} className="rounded-xl border border-stone-300 px-5 py-3 text-center font-bold text-stone-900">
                Sign in with Microsoft
              </a>
            </div>

            <div className="border-t border-stone-200 pt-6">
              <h2 className="font-bold text-stone-900 mb-2">Fallback if OAuth is blocked</h2>
              <p className="text-sm text-stone-600 mb-3">Start a local session, then redeem an in-person staff verification code.</p>
              <form onSubmit={startLocalSession} className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <input
                  value={localName}
                  onChange={(event) => setLocalName(event.target.value)}
                  placeholder="Full name"
                  className="border border-stone-300 rounded-xl px-3 py-2"
                  required
                />
                <input
                  type="email"
                  value={localEmail}
                  onChange={(event) => setLocalEmail(event.target.value)}
                  placeholder="Email"
                  className="border border-stone-300 rounded-xl px-3 py-2"
                  required
                />
                <button disabled={submitting} className="w-full rounded-xl bg-yellow-400 px-4 py-2 font-bold text-stone-900 disabled:opacity-50 md:w-auto">
                  {submitting ? 'Starting...' : 'Start Session'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div>
                <div className="font-semibold text-stone-900">{user.name}</div>
                <div className="text-sm text-stone-600">{user.email}</div>
                <div className="text-xs text-stone-500 mt-1">
                  Status:{' '}
                  {user.verifiedStaff
                    ? `Verified (${user.staffVerifyMethod || 'Unknown method'})`
                    : 'Not verified yet'}
                </div>
              </div>
              <button
                type="button"
                className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm sm:w-auto"
                onClick={() => {
                  clearStaffToken();
                  setUser(null);
                  setPerformances([]);
                  setSeats([]);
                }}
              >
                Sign out
              </button>
            </div>

            {!user.verifiedStaff ? (
              <form onSubmit={redeemStaffCode} className="space-y-3">
                <div>
                  <label className="text-sm font-semibold text-stone-700">Redeem in-person verification code</label>
                  <input
                    value={redeemCode}
                    onChange={(event) => setRedeemCode(event.target.value)}
                    placeholder="XXXX-XXXX-XXXX"
                    className="w-full border border-stone-300 rounded-xl px-3 py-2 mt-1"
                    required
                  />
                </div>
                <button disabled={submitting} className="w-full rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:opacity-50 sm:w-auto">
                  {submitting ? 'Redeeming...' : 'Redeem Code'}
                </button>
              </form>
            ) : (
              <form onSubmit={reserveCompTicket} className="space-y-4">
                <div className="grid grid-cols-1 gap-3">
                  <select
                    value={performanceId}
                    onChange={(event) => setPerformanceId(event.target.value)}
                    className="border border-stone-300 rounded-xl px-3 py-2"
                    required
                  >
                    {performances.map((performance) => (
                      <option key={performance.id} value={performance.id}>
                        {performance.title} - {new Date(performance.startsAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border border-stone-200 rounded-xl p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-stone-900">Choose a Seat</h3>
                    <div className="text-xs text-stone-500">
                      {selectedSeat
                        ? `Selected: ${selectedSeat.sectionName} ${selectedSeat.row}-${selectedSeat.number}`
                        : 'Click an available seat'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500 mb-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-white border border-stone-300" />
                      Available
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-green-500" />
                      Selected
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-orange-300" />
                      Held
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full bg-stone-300" />
                      Unavailable
                    </span>
                  </div>

                  {availableSeats.length === 0 ? (
                    <div className="text-sm text-stone-500">No staff-comp seats are currently available for this performance.</div>
                  ) : (
                    <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                      {sections.map((sectionName) => (
                        <div key={sectionName}>
                          <div className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2">{sectionName}</div>
                          <div className="space-y-2">
                            {Object.keys(seatGrid[sectionName]).sort(naturalSort).map((row) => (
                              <div key={`${sectionName}-${row}`} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                                <div className="text-xs font-semibold text-stone-500 sm:w-10 sm:pt-2">Row {row}</div>
                                <div className="flex flex-wrap gap-2">
                                  {seatGrid[sectionName][row].map((seat) => {
                                    const selectable = seat.status === 'available' && !seat.isCompanion;
                                    const selected = seat.id === seatId;

                                    let statusClass = 'bg-stone-300 text-stone-600 border-stone-300 cursor-not-allowed';
                                    if (selected) statusClass = 'bg-green-600 text-white border-green-700 shadow-sm';
                                    else if (selectable) statusClass = 'bg-white text-stone-900 border-stone-300 hover:border-stone-500 hover:bg-stone-50';
                                    else if (seat.status === 'held') statusClass = 'bg-orange-200 text-orange-900 border-orange-300 cursor-not-allowed';

                                    return (
                                      <button
                                        key={seat.id}
                                        type="button"
                                        onClick={() => selectable && setSeatId(seat.id)}
                                        disabled={!selectable}
                                        title={`${sectionName} Row ${seat.row} Seat ${seat.number}`}
                                        className={`min-w-10 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${statusClass}`}
                                      >
                                        {seat.number}
                                        {seat.isAccessible ? 'A' : ''}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  value={attendeeName}
                  onChange={(event) => setAttendeeName(event.target.value)}
                  placeholder="Attendee name (optional)"
                  className="w-full border border-stone-300 rounded-xl px-3 py-2"
                />

                <input
                  value={teacherPromoCode}
                  onChange={(event) => setTeacherPromoCode(event.target.value)}
                  placeholder="Teacher promo code"
                  className="w-full border border-stone-300 rounded-xl px-3 py-2"
                  required
                />

                {selectedPerformance && (
                  <div className="text-xs text-stone-500">
                    Staff comp limit per user for this performance: {selectedPerformance.staffCompLimitPerUser}
                  </div>
                )}

                <button
                  disabled={submitting || !performanceId || !seatId}
                  className="w-full rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:opacity-50"
                >
                  {submitting ? 'Reserving...' : 'Reserve Staff Comp Ticket'}
                </button>
              </form>
            )}
          </div>
        )}

        {error && <div className="text-sm text-red-600 mt-4">{error}</div>}
      </div>
    </div>
  );
}
