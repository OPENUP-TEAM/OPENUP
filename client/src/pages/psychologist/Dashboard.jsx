import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

// Figure 36: Psychologist Dashboard.
// Reads the booking endpoints that already exist on the server.
export default function PsychologistDashboard() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/bookings')
      .then(({ bookings }) => setBookings(bookings))
      .catch((err) => setError(err.message));
  }, []);

  const pending = bookings.filter((b) => b.status === 'pending');
  const upcoming = bookings.filter(
    (b) => b.status === 'confirmed' && new Date(b.schedule) > new Date()
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">Licensed psychologist</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3 py-2.5">
          {error}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Pending requests', value: pending.length },
          { label: 'Upcoming sessions', value: upcoming.length },
          { label: 'Completed', value: bookings.filter((b) => b.status === 'completed').length },
        ].map(({ label, value }) => (
          <div key={label} className="card p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight">{value}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Session requests</h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No requests waiting.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {pending.map((b) => (
              <li key={b.booking_id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">{b.display_alias || b.resident_name}</p>
                  <p className="text-sm text-ink-soft">
                    {format(parseISO(b.schedule), "EEE d MMM 'at' h:mm a")}
                  </p>
                </div>
                <span className="text-xs text-ink-faint">Accept / decline coming next</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-ink-faint">
        Availability, client management, and reports are not built yet.
      </p>
    </div>
  );
}
