import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2, Clock, TrendingUp, CalendarCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Figure 36: Psychologist Dashboard.
 *
 * Module: Psychologist Dashboard
 *   1. Manage Availability / Calendar
 *   2. View Scheduled Sessions
 *   3. Track Earnings
 *
 * Availability is the important half. Until this existed, the only way to
 * change when a psychologist works was a SQL statement, which meant residents
 * could never see accurate open slots.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

export default function PsychologistDashboard() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [earnings, setEarnings] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ day_of_week: '1', start_time: '09:00', end_time: '17:00' });

  const load = () => {
    api('/bookings').then(({ bookings }) => setBookings(bookings)).catch(() => {});
    api('/me/psychologist/availability')
      .then(({ availability }) => setAvailability(availability))
      .catch((err) => setError(err.message));
    api('/me/psychologist/earnings').then(setEarnings).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const addWindow = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api('/me/psychologist/availability', { method: 'POST', body: form });
      setNotice(`${DAYS[form.day_of_week]} added. Residents can book these hours now.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeWindow = async (id) => {
    setError('');
    setNotice('');
    try {
      const r = await api(`/me/psychologist/availability/${id}`, { method: 'DELETE' });
      setNotice(r.note || 'Removed.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const pending = bookings.filter((b) => b.status === 'pending');
  const upcoming = bookings
    .filter((b) => b.status === 'confirmed' && new Date(b.schedule) > new Date())
    .sort((a, b) => new Date(a.schedule) - new Date(b.schedule));

  const byDay = DAYS.map((_, i) => availability.filter((a) => a.day_of_week === i));
  const maxEarned = Math.max(...(earnings?.monthly ?? []).map((m) => Number(m.earned)), 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">Licensed psychologist</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Requests waiting', value: pending.length, link: '/psychologist/requests' },
          { label: 'Sessions booked', value: earnings?.upcoming_count ?? upcoming.length },
          { label: 'Completed', value: earnings?.sessions_completed ?? '—' },
          { label: 'Earned', value: peso(earnings?.earned) },
        ].map(({ label, value, link }) => (
          <div key={label} className="card p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
            {link && value > 0 && (
              <Link to={link} className="mt-2 inline-block text-xs font-semibold text-tide-700 underline">
                Review them
              </Link>
            )}
          </div>
        ))}
      </section>

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 1. Manage Availability */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Clock size={17} className="text-tide-500" />
          When you are available
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Residents can only book inside these hours. Sessions are one hour long.
        </p>

        <form onSubmit={addWindow} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="day">Day</label>
            <select
              id="day" className="field w-40" value={form.day_of_week}
              onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="from">From</label>
            <input
              id="from" type="time" className="field w-32" value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input
              id="to" type="time" className="field w-32" value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-primary h-11">
            <Plus size={16} />
            Add
          </button>
        </form>

        <ul className="mt-5 divide-y divide-line">
          {byDay.map((windows, day) => (
            <li key={day} className="py-2.5 flex items-start gap-4">
              <span className={`w-24 shrink-0 text-sm ${windows.length ? 'font-semibold' : 'text-ink-faint'}`}>
                {DAYS[day]}
              </span>
              {windows.length === 0 ? (
                <span className="text-sm text-ink-faint">Not available</span>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {windows.map((w) => (
                    <li key={w.availability_id}
                        className="flex items-center gap-2 bg-tide-50 rounded-pill pl-3 pr-1.5 py-1">
                      <span className="text-sm tabular-nums">
                        {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}
                      </span>
                      <button
                        onClick={() => removeWindow(w.availability_id)}
                        className="p-1 rounded-full hover:bg-tide-100"
                        aria-label={`Remove ${DAYS[day]} ${w.start_time.slice(0, 5)}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 2. View Scheduled Sessions */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <CalendarCheck size={17} className="text-tide-500" />
            Next sessions
          </h2>
          <Link to="/psychologist/requests" className="text-sm font-semibold text-tide-700 underline">
            See all
          </Link>
        </div>

        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing confirmed yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {upcoming.slice(0, 5).map((b) => (
              <li key={b.booking_id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">{b.display_alias || b.resident_name}</p>
                  <p className="text-sm text-ink-soft">
                    {format(parseISO(b.schedule), "EEE d MMM, h:mm a")}
                  </p>
                </div>
                <Link to={`/psychologist/session/${b.booking_id}`} className="btn-quiet h-9 px-4">
                  Open room
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Track Earnings */}
      {earnings?.monthly?.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <TrendingUp size={17} className="text-tide-500" />
            Earnings by month
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Counted when a session is marked complete. {peso(earnings.scheduled_value)} is
            booked but not yet earned.
          </p>
          <ul className="mt-4 space-y-2.5">
            {earnings.monthly.map((m) => (
              <li key={m.month} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-ink-soft">
                  {format(parseISO(m.month), 'MMM yyyy')}
                </span>
                <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                  <div
                    className="h-full rounded-pill bg-tide-500"
                    style={{ width: `${(Number(m.earned) / maxEarned) * 100}%` }}
                  />
                </div>
                <span className="w-24 text-right text-sm tabular-nums">{peso(m.earned)}</span>
                <span className="w-20 text-right text-xs text-ink-faint">
                  {m.sessions} session{m.sessions === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
