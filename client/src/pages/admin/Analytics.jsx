import { useEffect, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import {
  TrendingUp, Activity, CalendarCheck, Wallet, Download, Database,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';

/**
 * Module: Reports & Analytics.
 *   1. View Platform Reports  2. Generate Analytics  3. Export Data
 *
 * Exports carry no resident identifier. A CSV is the easiest way for
 * clinical data to walk out of a system — it gets emailed, copied to a
 * laptop, left in a Downloads folder — so the identifier is simply not in
 * the file to begin with.
 */
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;
const iso = (d) => d.toISOString().slice(0, 10);

const DATASETS = [
  { key: 'sessions',  label: 'Sessions',          note: 'One row per booking. No resident column.' },
  { key: 'barangays', label: 'Barangay summary',  note: 'Credits, mood and wellness index per barangay.' },
  { key: 'alerts',    label: 'Crisis alerts',     note: 'Risk level and outcome. No resident column.' },
];

const PRESETS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 182 },
  { label: 'Year', days: 365 },
];

export default function Analytics() {
  const [from, setFrom] = useState(iso(subDays(new Date(), 90)));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api(`/analytics/platform?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  const exportCsv = async (dataset) => {
    setError('');
    try {
      const res = await fetch(
        `/api/analytics/platform/export?dataset=${dataset}&from=${from}&to=${to}`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openup-${dataset}-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const g = data?.growth ?? [];
  const a = data?.activity;
  const s = data?.service;
  const m = data?.money;
  const growthMax = Math.max(...g.map((x) => x.residents), 1);

  return (
    <div className="space-y-8">
      <div className="no-print">
        <h1 className="text-2xl font-bold tracking-tight">Reports and analytics</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Platform-wide figures. Exports contain no resident identifier.
        </p>
      </div>

      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setFrom(iso(subDays(new Date(), p.days))); setTo(iso(new Date())); }}
              className="h-9 px-3.5 rounded-pill border border-line text-sm font-medium hover:bg-paper-sunk"
            >
              {p.label}
            </button>
          ))}
        </div>
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
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : data && (
        <>
          {/* Service delivery: the figures that say whether the thing works */}
          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <CalendarCheck size={17} className="text-tide-500" />
              Service delivery
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[
                ['Sessions completed', s.completed],
                ['Residents served', s.residents_served],
                ['Psychologists active', s.psychologists_active],
                ['Completion rate',
                  s.completion_rate === null ? '—' : `${s.completion_rate}%`],
              ].map(([label, value]) => (
                <div key={label} className="card p-5">
                  <p className="text-sm text-ink-soft">{label}</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {s.bookings} bookings, {s.missed} missed, {s.cancelled} cancelled,{' '}
              {s.group_sessions} group.
              {s.completion_rate === null &&
                ' Completion rate needs at least ten completed or missed sessions.'}
            </p>
          </section>

          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <Activity size={17} className="text-tide-500" />
              Resident activity
            </h2>
            <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {[
                ['Mood entries', a.mood_entries],
                ['Voice journals', a.journals],
                ['Assessments taken', a.assessments],
                ['Companion conversations', a.ai_chats],
                ['Chat messages', a.chat_messages],
                ['Community posts', a.posts],
              ].map(([label, value]) => (
                <li key={label} className="flex justify-between text-sm">
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-semibold tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
          </section>

          {g.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 font-bold">
                <TrendingUp size={17} className="text-tide-500" />
                Sign-ups by month
              </h2>
              <ul className="mt-4 space-y-2.5">
                {g.map((row) => (
                  <li key={row.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm text-ink-soft">
                      {format(parseISO(row.month), 'MMM yyyy')}
                    </span>
                    <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                      <div className="h-full rounded-pill bg-tide-500"
                           style={{ width: `${(row.residents / growthMax) * 100}%` }} />
                    </div>
                    <span className="w-28 text-right text-xs text-ink-faint">
                      {row.residents} resident{row.residents === 1 ? '' : 's'}
                      {row.psychologists > 0 && `, ${row.psychologists} psych`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <Wallet size={17} className="text-tide-500" />
              Money
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[
                ['Annual subscription revenue', peso(m.subscription_revenue)],
                ['Active subscriptions', m.active_subscriptions],
                ['Awaiting payment', m.awaiting_payment],
                ['Credits spent in period', peso(m.credits_spent)],
              ].map(([label, value]) => (
                <div key={label} className="card p-5">
                  <p className="text-sm text-ink-soft">{label}</p>
                  <p className="mt-2 text-xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {peso(m.credits_allocated)} of Care Credits were allocated in this period.
            </p>
          </section>

          {/* 3. Export Data */}
          <section className="no-print">
            <h2 className="flex items-center gap-2 font-bold">
              <Database size={17} className="text-tide-500" />
              Export
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              CSV, for the selected period. No export includes a resident name or
              identifier.
            </p>
            <ul className="mt-4 space-y-2.5">
              {DATASETS.map((d) => (
                <li key={d.key} className="card p-4 flex flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{d.label}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">{d.note}</p>
                  </div>
                  <button onClick={() => exportCsv(d.key)} className="btn-quiet h-9 px-4 text-xs">
                    <Download size={13} />
                    Export
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
