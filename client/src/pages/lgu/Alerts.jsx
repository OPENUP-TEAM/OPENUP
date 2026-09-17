import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Bell, Search, UserPlus, EyeOff, Clock, Check, X, Info,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 42: Barangay Risk Alerts.
 *
 * Two halves that deliberately do not join up.
 *
 * Alerts show barangay, risk level and date. Residents show names and
 * Care Credit position. Neither screen can tell you which resident an
 * alert belongs to, and that is the design, not an omission: a barangay
 * knowing who the system flagged would undo the anonymity the service is
 * built on.
 *
 * Referral runs the other way. A barangay worker who visits houses knows
 * things the app cannot see, so they can flag someone they are worried
 * about — and learn nothing back about whether the app agreed.
 */
const RISK_TONE = {
  severe:   'text-mood-1 bg-mood-1/12',
  high:     'text-mood-2 bg-mood-2/12',
  moderate: 'text-mood-3 bg-mood-3/12',
  low:      'text-ink-faint bg-paper-sunk',
};

const TABS = [
  { key: 'alerts',    label: 'Risk alerts' },
  { key: 'residents', label: 'Residents' },
];

export default function Alerts() {
  const [tab, setTab] = useState('alerts');
  const [level, setLevel] = useState('');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [residents, setResidents] = useState(null);
  const [q, setQ] = useState('');
  const [referring, setReferring] = useState(null);
  const [concern, setConcern] = useState('');
  const [urgency, setUrgency] = useState('moderate');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'alerts') return;
    setError('');
    const params = new URLSearchParams({ days });
    if (level) params.set('level', level);
    api(`/lgu/alerts?${params}`).then(setData).catch((e) => setError(e.message));
  }, [tab, level, days]);

  const loadResidents = () => {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    api(`/lgu/residents${params}`).then(setResidents).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (tab === 'residents') loadResidents();
  }, [tab, q]);

  const refer = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api(`/lgu/residents/${referring.user_id}/refer`, {
        method: 'POST',
        body: { concern: concern.trim(), urgency },
      });
      setNotice(
        `${r.psychologists_notified} psychologist${r.psychologists_notified === 1 ? '' : 's'} notified. ${r.note}`
      );
      setReferring(null);
      setConcern('');
      loadResidents();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Risk alerts</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What the system has detected, and who you can refer for support.
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

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 1. View Risk Alerts */}
      {tab === 'alerts' && data && (
        <>
          <p className="flex gap-2 text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">
            <EyeOff size={15} className="shrink-0 mt-0.5 text-ink-faint" />
            {data.note}
          </p>

          {data.summary.length > 0 && (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.summary.map((s) => (
                <div key={s.risk_level} className="card p-5">
                  <p className="text-sm text-ink-soft capitalize">{s.risk_level} risk</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                    {s.total}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {s.still_open} still open · {s.led_to_session} led to a session
                    {s.avg_hours_to_resolve && ` · ${s.avg_hours_to_resolve}h average to resolve`}
                  </p>
                </div>
              ))}
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {[['', 'All levels'], ['severe', 'Severe'], ['high', 'High'],
              ['moderate', 'Moderate']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setLevel(k)}
                className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
                  level === k ? 'border-tide-500 bg-tide-50' : 'border-line hover:bg-paper-sunk'
                }`}
              >
                {label}
              </button>
            ))}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                    className="field w-auto h-8 ml-auto text-sm" aria-label="Period">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>

          {data.alerts.length === 0 ? (
            <div className="card p-8 text-center">
              <Bell size={20} className="mx-auto text-ink-faint" />
              <p className="mt-3 text-sm text-ink-soft">
                No alerts in this period. That may mean nobody is in distress, or that
                nobody is using the service.
              </p>
            </div>
          ) : (
            <ul className="card divide-y divide-line">
              {data.alerts.map((a, i) => (
                <li key={i} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill capitalize ${
                    RISK_TONE[a.risk_level] ?? RISK_TONE.low
                  }`}>
                    {a.risk_level}
                  </span>
                  <span className="text-sm">{a.barangay_name}</span>
                  <span className="text-xs text-ink-faint capitalize">
                    {a.source.replace('_', ' ')}
                  </span>
                  {a.led_to_session && (
                    <span className="flex items-center gap-1 text-xs text-mood-5">
                      <Check size={12} />
                      session booked
                    </span>
                  )}
                  {a.days_open != null && a.days_open > 7 && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-mood-2">
                      <Clock size={12} />
                      open {a.days_open} days
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-faint tabular-nums">
                    {format(parseISO(a.created_at), 'd MMM, h:mm a')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* 2. Manage Barangay Residents, 3. Flag High-Risk Cases */}
      {tab === 'residents' && residents && (
        <>
          <p className="flex gap-2 text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">
            <Info size={15} className="shrink-0 mt-0.5 text-ink-faint" />
            {residents.note}
          </p>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search residents" className="field pl-9"
              aria-label="Search residents"
            />
          </div>

          {residents.residents.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm text-ink-soft">
                {q ? 'Nobody matches that.' : 'No residents registered yet.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {residents.residents.map((r) => (
                <li key={r.user_id} className="card p-4 flex flex-wrap items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {r.name}
                      {r.status !== 'active' && (
                        <span className="ml-2 text-xs text-mood-2">{r.status}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {r.credits_available} credit{r.credits_available === 1 ? '' : 's'} available ·{' '}
                      {r.credits_used} used ·{' '}
                      {r.has_attended ? 'has attended a session' : 'no sessions yet'}
                      {!r.counted_in_statistics && ' · opted out of statistics'}
                    </p>
                  </div>

                  {r.referral_open ? (
                    <span className="text-xs text-ink-faint shrink-0">Referral open</span>
                  ) : (
                    <button
                      onClick={() => { setReferring(r); setConcern(''); setUrgency('moderate'); }}
                      className="btn-quiet h-9 px-3 text-xs shrink-0"
                    >
                      <UserPlus size={13} />
                      Refer for support
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Referral */}
      {referring && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 px-5">
          <div className="card p-6 w-full max-w-md">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold">Refer {referring.name}</h2>
              <button onClick={() => setReferring(null)} className="p-1" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              This tells a psychologist you would like to make sure this resident has
              support. It is based on what your barangay knows, not on anything the system
              has recorded about them.
            </p>

            <label className="label mt-5" htmlFor="concern">What have you noticed?</label>
            <textarea
              id="concern" rows={3} value={concern}
              onChange={(e) => setConcern(e.target.value)}
              placeholder="Has not left the house in two weeks since losing their job. Family asked us to check in."
              className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong text-sm"
            />

            <span className="label mt-4">Urgency</span>
            <div className="grid grid-cols-2 gap-2 p-1 bg-paper-sunk rounded-pill">
              {[['moderate', 'Worth a check-in'], ['high', 'Concerned']].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setUrgency(v)}
                  className={`h-9 rounded-pill text-sm font-semibold ${
                    urgency === v ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs text-ink-faint leading-relaxed">
              The resident is told a referral was made. You will not be told whether the
              system had already flagged them, because that would reveal something they
              shared privately.
            </p>

            <div className="mt-5 flex gap-2">
              <button onClick={refer} disabled={concern.trim().length < 10 || busy}
                      className="btn-primary flex-1">
                {busy ? 'Sending…' : 'Send referral'}
              </button>
              <button onClick={() => setReferring(null)} className="btn-quiet px-5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
