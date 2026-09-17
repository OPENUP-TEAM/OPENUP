import { useEffect, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { TrendingDown, TrendingUp, Minus, Info, Flame } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 41: Mental Health Heatmap, and the Community Wellness Index
 * period comparison.
 *
 * The bands and their colours are the mood scale from MoodDot, so a
 * barangay in the red here means the same thing as a bad day in a
 * resident's chart. Reusing one scale is what makes the colour mean
 * something rather than decorate something.
 */
const iso = (d) => d.toISOString().slice(0, 10);

const BAND_STYLE = {
  severe:   { bar: 'bg-mood-1', text: 'text-mood-1' },
  high:     { bar: 'bg-mood-2', text: 'text-mood-2' },
  moderate: { bar: 'bg-mood-3', text: 'text-mood-3' },
  low:      { bar: 'bg-mood-5', text: 'text-mood-5' },
};

const PRESETS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 182 },
];

export default function Heatmap() {
  const [from, setFrom] = useState(iso(subDays(new Date(), 30)));
  const [to, setTo] = useState(iso(new Date()));
  const [level, setLevel] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ from, to });
    if (level) params.set('level', level);
    api(`/lgu/heatmap?${params}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [from, to, level]);

  const setPreset = (days) => {
    setFrom(iso(subDays(new Date(), days)));
    setTo(iso(new Date()));
  };

  const counts = (data?.barangays ?? []).reduce((acc, b) => {
    acc[b.band] = (acc[b.band] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Mental health heatmap</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A wellness index per barangay, from mood entries, engagement and crisis
          frequency. Residents who opted out of statistics are excluded.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.days)}
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

      {/* 3. Filter by Distress Level */}
      {data && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setLevel('')}
            className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
              level === '' ? 'border-tide-500 bg-tide-50' : 'border-line hover:bg-paper-sunk'
            }`}
          >
            All barangays
          </button>
          {data.bands.map((b) => (
            <button
              key={b.key}
              onClick={() => setLevel(level === b.key ? '' : b.key)}
              className={`flex items-center gap-2 h-8 px-3.5 rounded-pill text-sm font-medium border ${
                level === b.key ? 'border-tide-500 bg-tide-50' : 'border-line hover:bg-paper-sunk'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${BAND_STYLE[b.key].bar}`} />
              {b.label}
              {counts[b.key] > 0 && (
                <span className="text-ink-faint">{counts[b.key]}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : data && (
        <>
          <p className="text-xs text-ink-faint">
            {format(parseISO(data.period.from), 'd MMM yyyy')} to{' '}
            {format(parseISO(data.period.to), 'd MMM yyyy')}, compared with{' '}
            {format(parseISO(data.compared_with.from), 'd MMM')} to{' '}
            {format(parseISO(data.compared_with.to), 'd MMM yyyy')}.
          </p>

          {data.barangays.length === 0 ? (
            <div className="card p-8 text-center">
              <Flame size={20} className="mx-auto text-ink-faint" />
              <p className="mt-3 text-sm text-ink-soft">
                No barangay is in that band for this period.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {data.barangays.map((b) => {
                const style = BAND_STYLE[b.band];
                const mine = b.barangay_id === data.own_barangay_id;
                const Trend = b.change == null ? Minus
                  : b.change > 0 ? TrendingUp : b.change < 0 ? TrendingDown : Minus;

                return (
                  <li key={b.barangay_id}
                      className={`card p-4 ${mine ? 'border-tide-500' : ''}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 w-40 shrink-0">
                        <p className={`text-sm truncate ${mine ? 'font-bold' : 'font-medium'}`}>
                          {b.barangay_name}
                          {mine && <span className="text-tide-700"> · yours</span>}
                        </p>
                        <p className="text-xs text-ink-faint">
                          {b.resident_count} counted · {b.mood_entries} entries
                        </p>
                      </div>

                      <div className="flex-1 min-w-[120px] h-3 rounded-pill bg-paper-sunk overflow-hidden">
                        <div className={`h-full rounded-pill ${style.bar}`}
                             style={{ width: `${b.wellness_index}%` }} />
                      </div>

                      <div className="w-12 text-right">
                        <span className="text-lg font-extrabold tabular-nums">
                          {b.wellness_index}
                        </span>
                      </div>

                      {/* Direction of travel, which matters more than the level */}
                      <div className="w-20 text-right">
                        {b.change == null ? (
                          <span className="text-xs text-ink-faint">no prior</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            b.change > 0 ? 'text-mood-5'
                            : b.change < 0 ? 'text-mood-1' : 'text-ink-faint'
                          }`}>
                            <Trend size={13} />
                            {b.change > 0 ? '+' : ''}{b.change}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Silence is not wellbeing. */}
                    {b.no_data && (
                      <p className="mt-2.5 flex gap-2 text-xs text-ink-soft bg-paper-sunk rounded-[8px] px-3 py-2">
                        <Info size={13} className="shrink-0 mt-0.5" />
                        No mood entries in this period, so this score is a default rather
                        than a measurement. An empty month is not a good month.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <section className="card p-5">
            <h2 className="font-bold">How the index is built</h2>
            <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
              <li>60% average mood, from daily check-ins.</li>
              <li>25% engagement, the share of residents who checked in at all.</li>
              <li>15% inverse crisis frequency, relative to population.</li>
            </ul>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">
              A barangay where nobody uses the service scores low on engagement, which is
              intended: an unused subscription is a problem worth seeing. It also means a
              low score can reflect either distress or absence, and the two need different
              responses. The note above appears wherever there is no data to distinguish
              them.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
