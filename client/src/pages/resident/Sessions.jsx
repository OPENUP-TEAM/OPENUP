import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import { CalendarPlus, Video, Wallet, Clock } from 'lucide-react';
import { api } from '../../lib/api.js';

// Module: Counseling Booking — 2. View Scheduled Sessions, 3. Cancel.
const STATUS = {
  pending:   { label: 'Waiting for confirmation', tone: 'text-mood-3 bg-mood-3/12' },
  confirmed: { label: 'Confirmed',                tone: 'text-mood-5 bg-mood-5/12' },
  declined:  { label: 'Declined',                 tone: 'text-mood-1 bg-mood-1/12' },
  cancelled: { label: 'Cancelled',                tone: 'text-ink-faint bg-paper-sunk' },
  completed: { label: 'Completed',                tone: 'text-tide-700 bg-tide-100' },
  no_show:   { label: 'Missed',                   tone: 'text-mood-2 bg-mood-2/12' },
};

export default function Sessions() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api('/bookings')
      .then(({ bookings }) => setBookings(bookings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const cancel = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/bookings/${id}/cancel`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const upcoming = bookings.filter(
    (b) => ['pending', 'confirmed'].includes(b.status) && !isPast(parseISO(b.schedule))
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  const Card = ({ b }) => {
    const s = STATUS[b.status] ?? STATUS.pending;
    const canCancel = ['pending', 'confirmed'].includes(b.status) && !isPast(parseISO(b.schedule));
    const canJoin = b.status === 'confirmed';

    return (
      <li className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-pill ${s.tone}`}>
              {s.label}
            </span>
            <h3 className="mt-2.5 font-bold">{b.psychologist_name}</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
              <Clock size={13} />
              {format(parseISO(b.schedule), "EEEE d MMMM, h:mm a")}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {b.duration_min} minutes · {b.session_type === 'group' ? 'Group session' : 'One on one'}
            </p>
            {b.covered_by_credit && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-tide-700">
                <Wallet size={13} />
                Covered by a Care Credit
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            {canJoin && (
              <Link to={`/app/session/${b.booking_id}`} className="btn-primary h-9 px-4">
                <Video size={15} />
                Join
              </Link>
            )}
            {canCancel && (
              <button
                onClick={() => cancel(b.booking_id)}
                disabled={busyId === b.booking_id}
                className="btn-quiet h-9 px-4"
              >
                {busyId === b.booking_id ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your sessions</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Cancelling before a session returns the Care Credit to your balance.
          </p>
        </div>
        <Link to="/app/book" className="btn-primary h-10 px-4">
          <CalendarPlus size={16} />
          Book
        </Link>
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
            You have not booked a session yet.
          </p>
          <Link to="/app/book" className="btn-primary h-10 px-5 mt-4">
            Find a psychologist
          </Link>
        </div>
      ) : (
        <>
          <section>
            <h2 className="font-bold">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">Nothing scheduled.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {upcoming.map((b) => <Card key={b.booking_id} b={b} />)}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="font-bold">Earlier</h2>
              <ul className="mt-4 space-y-3">
                {past.map((b) => <Card key={b.booking_id} b={b} />)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
