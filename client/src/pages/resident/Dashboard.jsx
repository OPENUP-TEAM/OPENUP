import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import MoodDot, { MOOD_SCALE } from '../../components/MoodDot.jsx';

// Figure 26: User Dashboard.
export default function Dashboard() {
  const { user } = useAuth();
  const [moods, setMoods] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api('/moods?days=14').then(({ entries }) => setMoods(entries)).catch(() => {});
    api('/bookings?status=confirmed').then(({ bookings }) => setBookings(bookings)).catch(() => {});
  };
  useEffect(load, []);

  const today = new Date().toISOString().slice(0, 10);
  const todayEntry = moods.find((m) => m.entry_date.slice(0, 10) === today);

  const logMood = async (level) => {
    setSaving(true);
    try {
      await api('/moods', { method: 'POST', body: { mood_level: level } });
      load();
    } finally {
      setSaving(false);
    }
  };

  const next = bookings
    .filter((b) => new Date(b.schedule) > new Date())
    .sort((a, b) => new Date(a.schedule) - new Date(b.schedule))[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Kumusta, {user?.display_alias || user?.name?.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {todayEntry ? 'Thanks for checking in today.' : 'How are you doing today?'}
        </p>
      </div>

      {/* Today's mood check-in */}
      <section className="card p-5">
        <h2 className="font-bold">Today's check-in</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              onClick={() => logMood(level)}
              disabled={saving}
              aria-pressed={todayEntry?.mood_level === level}
              className={`flex items-center gap-2 h-11 px-4 rounded-pill border text-sm font-medium
                ${todayEntry?.mood_level === level
                  ? 'border-tide-500 bg-tide-50'
                  : 'border-line-strong hover:bg-paper-sunk'}`}
            >
              <MoodDot level={level} />
              {MOOD_SCALE[level].label}
            </button>
          ))}
        </div>
      </section>

      {/* Recent trend */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold">Last two weeks</h2>
          <Link to="/app/mood" className="text-sm font-semibold text-tide-700 underline">
            See full history
          </Link>
        </div>
        {moods.length === 0 ? (
          <p className="mt-4 text-sm text-ink-soft">
            Log a few days and your pattern will show up here.
          </p>
        ) : (
          <ol className="mt-4 flex items-end gap-1.5 h-24">
            {moods.map((m) => (
              <li key={m.mood_id} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`w-full rounded-[4px] ${MOOD_SCALE[m.mood_level].bg}`}
                  style={{ height: `${m.mood_level * 18}%` }}
                  title={`${format(parseISO(m.entry_date), 'MMM d')} — ${MOOD_SCALE[m.mood_level].label}`}
                />
                <span className="text-[10px] text-ink-faint">
                  {format(parseISO(m.entry_date), 'd')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Next session */}
      <section className="card p-5">
        <h2 className="font-bold">Next session</h2>
        {next ? (
          <div className="mt-3 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">{next.psychologist_name}</p>
              <p className="text-sm text-ink-soft">
                {format(parseISO(next.schedule), "EEEE, d MMM 'at' h:mm a")}
                {next.covered_by_credit && ' · covered by Care Credits'}
              </p>
            </div>
            <Link to="/app/sessions" className="btn-primary h-9 px-4">View</Link>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-sm text-ink-soft">You have no sessions booked.</p>
            <Link to="/app/book" className="btn-quiet h-9 px-4">Book a session</Link>
          </div>
        )}
      </section>
    </div>
  );
}
