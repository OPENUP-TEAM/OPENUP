import { useEffect, useState } from 'react';
import { format, parseISO, subMonths } from 'date-fns';
import {
  Download, Printer, Save, Archive, ArrowLeft, FileText,
} from 'lucide-react';
import { api, getToken } from '../../lib/api.js';

/**
 * Figure 42: Accomplishment Report.
 *
 * This is the document a barangay captain takes to a budget meeting to
 * justify the line item, so it answers one question: what did the money
 * buy. Two ways out — CSV for someone who will add a column in Excel, and
 * print for someone who needs it on paper.
 */
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;
const iso = (d) => d.toISOString().slice(0, 10);

const PRESETS = [
  { label: 'Last month',    months: 1 },
  { label: 'Last quarter',  months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last year',     months: 12 },
];

export default function Reports() {
  const [from, setFrom] = useState(iso(subMonths(new Date(), 3)));
  const [to, setTo] = useState(iso(new Date()));
  const [report, setReport] = useState(null);
  const [saved, setSaved] = useState([]);
  const [viewingSaved, setViewingSaved] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api(`/reports/accomplishment?from=${from}&to=${to}`)
      .then(({ report }) => setReport(report))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadSaved = () =>
    api('/reports/accomplishment/saved')
      .then(({ reports }) => setSaved(reports))
      .catch(() => {});

  useEffect(() => { load(); }, [from, to]);
  useEffect(() => { loadSaved(); }, []);

  const exportCsv = async () => {
    // A download needs the auth header, so it cannot be a plain link.
    try {
      const res = await fetch(
        `/api/reports/accomplishment?from=${from}&to=${to}&format=csv`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );
      if (!res.ok) throw new Error('Export failed.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openup-accomplishment-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async () => {
    setError('');
    setNotice('');
    try {
      await api(`/reports/accomplishment/save?from=${from}&to=${to}`, { method: 'POST' });
      setNotice('Report saved. It keeps these figures even as the data changes.');
      loadSaved();
    } catch (e) {
      setError(e.message);
    }
  };

  const openSaved = async (id) => {
    try {
      const r = await api(`/reports/accomplishment/saved/${id}`);
      setReport(r.report);
      setViewingSaved(r);
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e.message);
    }
  };

  const setPreset = (months) => {
    setViewingSaved(null);
    setFrom(iso(subMonths(new Date(), months)));
    setTo(iso(new Date()));
  };

  const s = report?.sessions;
  const c = report?.credits;
  const e = report?.engagement;
  const cr = report?.crisis;

  return (
    <div className="space-y-6">
      <div className="no-print">
        <h1 className="text-2xl font-bold tracking-tight">Accomplishment report</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What your subscription delivered over a period. Aggregate figures only; no
          resident is named.
        </p>
      </div>

      {/* Controls, hidden when printing */}
      <div className="no-print space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.months)}
              className="h-8 px-3.5 rounded-pill border border-line text-sm font-medium hover:bg-paper-sunk"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="from">From</label>
            <input id="from" type="date" className="field w-auto" value={from}
                   onChange={(e) => { setViewingSaved(null); setFrom(e.target.value); }} />
          </div>
          <div>
            <label className="label" htmlFor="to">To</label>
            <input id="to" type="date" className="field w-auto" value={to}
                   onChange={(e) => { setViewingSaved(null); setTo(e.target.value); }} />
          </div>
          <button onClick={exportCsv} className="btn-quiet h-11 px-4">
            <Download size={15} />
            Export CSV
          </button>
          <button onClick={() => window.print()} className="btn-quiet h-11 px-4">
            <Printer size={15} />
            Print
          </button>
          <button onClick={save} className="btn-primary h-11 px-4">
            <Save size={15} />
            Save
          </button>
        </div>
      </div>

      {notice && (
        <p className="no-print text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="no-print text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {viewingSaved && (
        <div className="no-print flex items-center justify-between gap-3 bg-paper-sunk rounded-[10px] px-3.5 py-3">
          <p className="text-sm">
            Viewing a report saved{' '}
            {format(parseISO(viewingSaved.generated_at), "d MMM yyyy 'at' h:mm a")}
            {viewingSaved.generated_by_name && ` by ${viewingSaved.generated_by_name}`}.
          </p>
          <button onClick={() => { setViewingSaved(null); load(); }}
                  className="btn-quiet h-8 px-3 text-xs">
            <ArrowLeft size={13} />
            Back to live
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Building the report…</p>
      ) : report && (
        <article className="space-y-8">
          {/* Document header, which only matters on paper */}
          <header className="border-b border-line pb-4">
            <h2 className="text-xl font-bold tracking-tight">
              {report.subject} — mental wellness accomplishment report
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {format(parseISO(report.period.from), 'd MMMM yyyy')} to{' '}
              {format(parseISO(report.period.to), 'd MMMM yyyy')}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              Generated by OpenUp. Aggregate figures; no resident is identified.
            </p>
          </header>

          <section>
            <h3 className="font-bold">Sessions delivered</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[
                ['Completed', s.completed],
                ['Residents served', s.residents_served],
                ['Hours delivered', s.hours],
                ['Psychologists engaged', s.psychologists_used],
              ].map(([label, value]) => (
                <div key={label} className="card p-4">
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-soft">
              {s.group_sessions} group session{s.group_sessions === 1 ? '' : 's'},{' '}
              {s.missed} missed, {s.cancelled} cancelled.
            </p>
          </section>

          <section>
            <h3 className="font-bold">Care Credits</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[
                ['Allocated', c.allocated],
                ['Used', c.used],
                ['Held by residents', c.with_residents],
                ['Unassigned', c.in_pool],
              ].map(([label, value]) => (
                <div key={label} className="card p-4">
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-soft">
              {peso(c.value_used)} of {peso(c.value_allocated)} allocated has been used on
              completed sessions.
            </p>
          </section>

          <section>
            <h3 className="font-bold">Resident engagement</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[
                ['Registered', e.registered],
                ['Logged a mood', e.logged_mood],
                ['Assessments taken', e.assessments],
                ['Voice journals', e.journals],
              ].map(([label, value]) => (
                <div key={label} className="card p-4">
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-soft">
              {e.participation_rate}% of registered residents used the service in this
              period, across {e.mood_entries} mood entries.
            </p>
          </section>

          <section>
            <h3 className="font-bold">Crisis response</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-4">
              {[
                ['Alerts raised', cr.raised],
                ['Severe', cr.severe],
                ['Resolved', cr.resolved],
                ['Led to a session', cr.led_to_session],
              ].map(([label, value]) => (
                <div key={label} className="card p-4">
                  <dt className="text-xs text-ink-faint">{label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {cr.raised === 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                No crisis alerts were raised in this period.
              </p>
            )}
          </section>

          {report.by_barangay?.length > 0 && (
            <section>
              <h3 className="font-bold">By barangay</h3>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-2 font-semibold">Barangay</th>
                    <th className="py-2 font-semibold text-right">Sessions</th>
                    <th className="py-2 font-semibold text-right">Residents</th>
                    <th className="py-2 font-semibold text-right">Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_barangay.map((b) => (
                    <tr key={b.barangay} className="border-b border-line last:border-0">
                      <td className="py-2">{b.barangay}</td>
                      <td className="py-2 text-right tabular-nums">{b.sessions}</td>
                      <td className="py-2 text-right tabular-nums">{b.residents}</td>
                      <td className="py-2 text-right tabular-nums">{peso(b.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      )}

      {/* Saved reports, so March's figures stay March's figures */}
      {saved.length > 0 && (
        <section className="no-print">
          <h2 className="flex items-center gap-2 font-bold">
            <Archive size={16} className="text-tide-500" />
            Saved reports
          </h2>
          <ul className="mt-3 space-y-2">
            {saved.map((r) => (
              <li key={r.report_id}>
                <button
                  onClick={() => openSaved(r.report_id)}
                  className="card p-3.5 w-full text-left flex items-center gap-3 hover:border-line-strong"
                >
                  <FileText size={15} className="text-ink-faint shrink-0" />
                  <span className="text-sm">
                    {format(parseISO(r.period_start), 'd MMM yyyy')} to{' '}
                    {format(parseISO(r.period_end), 'd MMM yyyy')}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">
                    saved {format(parseISO(r.generated_at), 'd MMM yyyy')}
                    {r.generated_by_name && ` by ${r.generated_by_name}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
