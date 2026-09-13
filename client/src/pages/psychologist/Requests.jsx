import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import { Check, X, Clock, Wallet, UserRound, Video } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 37: Appointment Requests.
 *
 * Module: Appointment Requests — 1. View Requests, 2. Accept, 3. Decline.
 *
 * Residents appear under their display alias where they set one. A
 * counselor deciding whether to take a slot does not need a legal name,
 * and the resident chose that alias precisely so they could ask for help
 * without being identified.
 */
const STATUS = {
  pending:   { label: 'Awaiting your response', tone: 'text-mood-3 bg-mood-3/12' },
  confirmed: { label: 'Confirmed',              tone: 'text-mood-5 bg-mood-5/12' },
  declined:  { label: 'Declined',               tone: 'text-mood-1 bg-mood-1/12' },
  cancelled: { label: 'Cancelled by resident',  tone: 'text-ink-faint bg-paper-sunk' },
  completed: { label: 'Completed',              tone: 'text-tide-700 bg-tide-100' },
  no_show:   { label: 'Marked as missed',       tone: 'text-mood-2 bg-mood-2/12' },
};

const TABS = [
  { key: 'pending',   label: 'Requests' },
  { key: 'confirmed', label: 'Upcoming' },
  { key: 'all',       label: 'All' },
];

export default function Requests() {
  const [tab, setTab] = useState('pending');
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    const qs = tab === 'all' ? '' : `?status=${tab}`;
    api(`/bookings${qs}`)
      .then(({ bookings }) => setBookings(bookings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const setStatus = async (id, status) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/bookings/${id}/status`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Appointment requests</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Declining a request frees the slot and returns the resident's Care Credit.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-9 px-4 rounded-pill text-sm font-semibold ${
              tab === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : bookings.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-soft">
            {tab === 'pending'
              ? 'No requests waiting. New ones appear here as residents book.'
              : tab === 'confirmed'
                ? 'Nothing confirmed yet.'
                : 'No sessions yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => {
            const s = STATUS[b.status] ?? STATUS.pending;
            const past = isPast(parseISO(b.schedule));
            const isPending = b.status === 'pending';
            const isConfirmed = b.status === 'confirmed';
            const busy = busyId === b.booking_id;

            return (
              <li key={b.booking_id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-pill ${s.tone}`}>
                      {s.label}
                    </span>

                    <h3 className="mt-2.5 flex items-center gap-2 font-bold">
                      <UserRound size={15} className="text-ink-faint" />
                      {b.display_alias || b.resident_name}
                    </h3>

                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
                      <Clock size={13} />
                      {format(parseISO(b.schedule), "EEEE d MMMM, h:mm a")}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {b.duration_min} minutes ·{' '}
                      {b.session_type === 'group' ? 'Group session' : 'One on one'}
                    </p>
                    {b.covered_by_credit && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-tide-700">
                        <Wallet size={13} />
                        Paid by barangay Care Credit
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 min-w-[140px]">
                    {isPending && !past && (
                      <>
                        <button
                          onClick={() => setStatus(b.booking_id, 'confirmed')}
                          disabled={busy}
                          className="btn-primary h-9 px-4"
                        >
                          <Check size={15} />
                          Accept
                        </button>
                        <button
                          onClick={() => setStatus(b.booking_id, 'declined')}
                          disabled={busy}
                          className="btn-quiet h-9 px-4"
                        >
                          <X size={15} />
                          Decline
                        </button>
                      </>
                    )}

                    {isPending && past && (
                      <p className="text-xs text-ink-faint">
                        This slot has already passed.
                      </p>
                    )}

                    {isConfirmed && !past && (
                      <Link
                        to={`/psychologist/session/${b.booking_id}`}
                        className="btn-primary h-9 px-4"
                      >
                        <Video size={15} />
                        Join
                      </Link>
                    )}

                    {/* Only offered after the fact: marking a session complete
                        consumes the resident's credit, so it must not be
                        possible before the session has happened. */}
                    {isConfirmed && past && (
                      <>
                        <button
                          onClick={() => setStatus(b.booking_id, 'completed')}
                          disabled={busy}
                          className="btn-primary h-9 px-4"
                        >
                          Mark complete
                        </button>
                        <button
                          onClick={() => setStatus(b.booking_id, 'no_show')}
                          disabled={busy}
                          className="btn-quiet h-9 px-4"
                        >
                          Did not attend
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
