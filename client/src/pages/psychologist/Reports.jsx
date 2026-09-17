import { useEffect, useState } from 'react';
import { format, parseISO, subMonths } from 'date-fns';
import { Download, Printer, TrendingUp, CalendarCheck } from 'lucide-react';
import { api, getToken } from '../../lib/api.js';

/**
 * Figure 39: Psychologist Reports.
 *
 * A freelancer needs two things from a platform: proof of what they
 * delivered, and a number they can put on a BIR form. Both export to CSV,
 * because that is what gets attached to an email or handed to an
 * accountant.
 */
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;
const iso = (d) => d.toISOString().slice(0, 10);

const STATUS_LABEL = {
  completed: 'Completed', no_show: 'Missed', cancelled: 'Cancelled',
  declined: 'Declined', confirmed: 'Confirmed', pending: 'Pending',
};

export default function Reports() {
  const [tab, setTab] = useState('sessions');
  const [from, setFrom] = useState(iso(subMonths(new Date(), 3)));
  const [to, setTo] = useState(iso(new Date()));
  const [sessions, setSessions] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    const qs = `?from=${from}&to=${to}`;
    if (tab === 'sessions')
      api(`/reports/psychologist/sessions${qs}`).then(setSessions).catch((e) => setError(e.message));
    if (tab === 'earnings')
      api(`/reports/psychologist/earnings${qs}`).then(setEarnings).catch((e) => setError(e.message));
  }, [tab, from, to]);

  const exportCsv = async () => {
    try {
      const res = await fetch(
        `/api/reports/psychologist/${tab}?from=${from}&to=${to}&format=csv`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openup-${tab}-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const maxEarned = Math.max(...(earnings?.monthly ?? []).map((m) => Number(m.earned)), 1);

  return (
    <div className="space-y-6">
      <div className="no-print">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Clients appear under their display names, the same as everywhere else.
        </p>
      </div>

      <div className="no-print flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {[['sessions', 'Sessions', CalendarCheck], ['earnings', 'Earnings', TrendingUp]]
          .map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 h-9 px-4 rounded-pill text-sm font-semibold ${
                tab === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
      </div>

      <div className="no-print flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" type="date" className="field w-auto" value={from}
                 onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" type="date" className="field w-auto" value={to}
                 onChange={(e) => setTo(e.target.value)} />
        </div>
        <button onClick={exportCsv} className="btn-quiet h-11 px-4">
          <Download size={15} />
          Export CSV
        </button>
        <button onClick={() => window.print()} className="btn-quiet h-11 px-4">
          <Printer size={15} />
          Print
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 1. View Session Reports */}
      {tab === 'sessions' && sessions && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            {[
              ['Completed', sessions.summary.completed],
              ['Hours delivered', sessions.summary.hours.toFixed(1)],
              ['Missed', sessions.summary.missed],
              ['Attendance',
                sessions.summary.attendance_rate === null
                  ? '—' : `${sessions.summary.attendance_rate}%`],
            ].map(([label, value]) => (
              <div key={label} className="card p-5">
                <p className="text-sm text-ink-soft">{label}</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>

          {sessions.summary.attendance_rate === null && (
            <p className="text-xs text-ink-faint">
              Attendance is shown once there are at least five completed or missed
              sessions. A rate over two sessions says nothing.
            </p>
          )}

          <section className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Minutes</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sessions.sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                      No sessions in this period.
                    </td>
                  </tr>
                ) : sessions.sessions.map((s) => (
                  <tr key={s.booking_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 tabular-nums">
                      {format(parseISO(s.schedule), 'd MMM yyyy, h:mm a')}
                    </td>
                    <td className="px-4 py-2.5">{s.client}</td>
                    <td className="px-4 py-2.5">
                      {s.session_type === 'group' ? 'Group' : 'One on one'}
                    </td>
                    <td className="px-4 py-2.5">{STATUS_LABEL[s.status] ?? s.status}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.duration_min}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {peso(s.amount)}
                      {s.care_credit && (
                        <span className="block text-xs text-ink-faint">Care Credit</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* 2. View Earnings Report */}
      {tab === 'earnings' && earnings && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            {[
              ['Earned', peso(earnings.totals.earned)],
              ['Sessions', earnings.totals.sessions],
              ['Hours', earnings.totals.hours.toFixed(1)],
              ['Funded by barangays', peso(earnings.totals.from_barangays)],
            ].map(([label, value]) => (
              <div key={label} className="card p-5">
                <p className="text-sm text-ink-soft">{label}</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>

          {earnings.pending?.sessions > 0 && (
            <p className="text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">
              {peso(earnings.pending.amount)} across {earnings.pending.sessions} confirmed
              future session{earnings.pending.sessions === 1 ? '' : 's'} is not counted
              above. Earnings are recorded when a session is marked complete.
            </p>
          )}

          <section className="card p-5">
            <h2 className="font-bold">By month</h2>
            {earnings.monthly.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">
                No completed sessions in this period.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {earnings.monthly.map((m) => (
                  <li key={m.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm text-ink-soft">
                      {format(parseISO(m.month), 'MMM yyyy')}
                    </span>
                    <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                      <div className="h-full rounded-pill bg-tide-500"
                           style={{ width: `${(Number(m.earned) / maxEarned) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-sm tabular-nums">
                      {peso(m.earned)}
                    </span>
                    <span className="w-24 text-right text-xs text-ink-faint">
                      {m.sessions} session{m.sessions === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-ink-faint leading-relaxed">
            These figures are what OpenUp recorded, not tax advice. Check them against your
            own records before filing anything.
          </p>
        </>
      )}
    </div>
  );
}
