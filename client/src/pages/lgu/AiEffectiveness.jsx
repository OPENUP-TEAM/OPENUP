import { useEffect, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Target, GitBranch, Star, Timer, Info, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: AI Effectiveness Tracker.
 *   1. View Detection Accuracy  2. View Escalation Outcomes
 *   3. View User Ratings
 *
 * The limits are shown as prominently as the figures, because the figures
 * are easy to over-read. Precision over reviewed alerts is a real number;
 * treating it as "the AI is 87% accurate" is not, and this screen is
 * written to make that hard to do by accident.
 */
const iso = (d) => d.toISOString().slice(0, 10);

const OUTCOME_LABEL = {
  session_booked:     'Booked a session',
  spoke_with_them:    'Spoke with them',
  referred_elsewhere: 'Referred elsewhere',
  could_not_reach:    'Could not reach',
  no_action_needed:   'No action needed',
};

const PRESETS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 182 },
];

export default function AiEffectiveness() {
  const [from, setFrom] = useState(iso(subDays(new Date(), 90)));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api(`/analytics/ai-effectiveness?from=${from}&to=${to}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to]);

  const d = data?.detection;
  const r = data?.ratings;
  const outcomeMax = Math.max(...(data?.outcomes ?? []).map((o) => o.n), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI effectiveness</h1>
        <p className="mt-1 text-sm text-ink-soft">
          How well crisis detection is working, measured against what psychologists
          found when they followed up.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
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
          {/* 1. View Detection Accuracy */}
          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <Target size={17} className="text-tide-500" />
              Detection
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[
                ['Alerts raised', d.raised],
                ['Reviewed', `${d.reviewed} (${d.review_rate}%)`],
                ['Confirmed real', d.confirmed_real],
                ['False alarms', d.false_positive],
              ].map(([label, value]) => (
                <div key={label} className="card p-5">
                  <p className="text-sm text-ink-soft">{label}</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4 card p-5">
              {d.precision === null ? (
                <>
                  <p className="font-bold">Not enough reviewed alerts to report accuracy</p>
                  <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">
                    {d.reviewed} of {d.raised} alerts have been reviewed by a psychologist.
                    A precision figure needs at least ten, because a percentage over a
                    handful of cases is noise. {d.still_open > 0 && (
                      <>There {d.still_open === 1 ? 'is' : 'are'} {d.still_open} still
                      open.</>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-soft">
                    Of the alerts a psychologist reviewed
                  </p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums">
                    {d.precision}%
                  </p>
                  <p className="mt-1.5 text-sm text-ink-soft">
                    were confirmed as a real concern.
                  </p>
                </>
              )}
            </div>

            {data.by_source.length > 0 && (
              <div className="mt-4 card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="px-4 py-3 font-semibold">Source</th>
                      <th className="px-4 py-3 font-semibold text-right">Raised</th>
                      <th className="px-4 py-3 font-semibold text-right">Real</th>
                      <th className="px-4 py-3 font-semibold text-right">False</th>
                      <th className="px-4 py-3 font-semibold text-right">Precision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_source.map((s) => (
                      <tr key={s.source} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 capitalize">{s.source.replace('_', ' ')}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{s.raised}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{s.confirmed_real}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{s.false_positive}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {s.precision === null
                            ? <span className="text-ink-faint">too few</span>
                            : `${s.precision}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 2. View Escalation Outcomes */}
          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <GitBranch size={17} className="text-tide-500" />
              What happened next
            </h2>
            {data.outcomes.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">
                No alerts have been resolved in this period, so there are no outcomes to
                report.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {data.outcomes.map((o) => (
                  <li key={o.outcome} className="flex items-center gap-3">
                    <span className="w-44 shrink-0 text-sm">
                      {OUTCOME_LABEL[o.outcome] ?? o.outcome}
                    </span>
                    <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                      <div className="h-full rounded-pill bg-tide-500"
                           style={{ width: `${(o.n / outcomeMax) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-sm tabular-nums">{o.n}</span>
                    <span className="w-24 text-right text-xs text-ink-faint">
                      {o.avg_hours ? `${o.avg_hours}h average` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. View User Ratings */}
          <section>
            <h2 className="flex items-center gap-2 font-bold">
              <Star size={17} className="text-tide-500" />
              What residents said
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[
                ['Conversations', r.conversations],
                ['Rated', r.rated],
                ['Average rating', r.avg_rating ?? '—'],
                ['Found it helpful', r.helpful],
              ].map(([label, value]) => (
                <div key={label} className="card p-5">
                  <p className="text-sm text-ink-soft">{label}</p>
                  <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            {r.rated > 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                {r.rated} of {r.conversations} conversations were rated. {r.unhelpful} rated
                it poorly.
              </p>
            )}
          </section>

          {data.response?.replies > 0 && (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-bold">
                <Timer size={17} className="text-tide-500" />
                Response time
              </h2>
              <p className="mt-2 text-sm text-ink-soft">
                The companion replied in {(data.response.avg_ms / 1000).toFixed(1)} seconds
                on average, across {data.response.replies} replies.
              </p>
            </section>
          )}

          {/* The limits, given the same weight as the numbers */}
          <section className="card p-5 border-mood-3">
            <h2 className="flex items-center gap-2 font-bold">
              <AlertTriangle size={17} className="text-mood-3" />
              What these numbers do not tell you
            </h2>
            <ul className="mt-3 space-y-2.5">
              {data.limits.map((l) => (
                <li key={l} className="flex gap-2.5 text-sm text-ink-soft leading-relaxed">
                  <Info size={14} className="shrink-0 mt-1 text-ink-faint" />
                  {l}
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-ink-faint">
            {format(parseISO(data.period.from), 'd MMM yyyy')} to{' '}
            {format(parseISO(data.period.to), 'd MMM yyyy')}.
          </p>
        </>
      )}
    </div>
  );
}
