import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Siren, Phone, Plus, Trash2, Check, TrendingUp, Clock, AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: AI Crisis Management.
 *   1. Configure Escalation Rules
 *   2. Manage Emergency Contacts
 *
 * The hotline list here is what a resident in crisis actually sees, in the
 * journal, the companion, the assessment and the community board. That is
 * why it is edited as a list of real fields rather than raw JSON: a typo
 * in a phone number is not a configuration mistake, it is a resident
 * dialling nothing.
 */
export default function AiCrisis() {
  const [hotlines, setHotlines] = useState([]);
  const [threshold, setThreshold] = useState(0.75);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api('/settings').then(({ settings }) => {
      const h = settings.find((s) => s.key === 'crisis_hotlines');
      const t = settings.find((s) => s.key === 'ai_escalation_threshold');
      if (h) setHotlines(h.value);
      if (t) setThreshold(t.value.risk_score);
    }).catch((e) => setError(e.message));
    api('/settings/crisis/overview').then(setOverview).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const saveHotlines = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/settings/crisis_hotlines', {
        method: 'PUT',
        body: { value: hotlines.filter((h) => h.name.trim() && h.number.trim()) },
      });
      setNotice('Hotlines updated. Residents see this list immediately.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveThreshold = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/settings/ai_escalation_threshold', {
        method: 'PUT',
        body: { value: { risk_score: Number(threshold) } },
      });
      setNotice('Threshold updated.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const setField = (i, field, v) =>
    setHotlines(hotlines.map((h, j) => (j === i ? { ...h, [field]: v } : h)));

  const weeklyMax = Math.max(...(overview?.weekly ?? []).map((w) => w.n), 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Crisis management</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What happens when the system detects someone may be in danger.
        </p>
      </div>

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* Open alerts first: a stale one is the only real emergency on this page. */}
      {overview?.open?.n > 0 && (
        <section className="rounded-card border-2 border-mood-1 bg-mood-1/5 p-5">
          <div className="flex gap-3">
            <AlertTriangle size={20} className="text-mood-1 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-bold">
                {overview.open.n} alert{overview.open.n === 1 ? '' : 's'} still open
              </h2>
              {overview.open.oldest && (
                <p className="mt-1 text-sm text-ink-soft">
                  Oldest raised {format(parseISO(overview.open.oldest), "d MMM 'at' h:mm a")}.
                  An open alert means nobody has picked it up.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2. Manage Emergency Contacts */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Phone size={17} className="text-mood-1" />
          Emergency numbers
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Shown to a resident the moment a crisis is detected. Check every number works
          before saving.
        </p>

        <ul className="mt-4 space-y-3">
          {hotlines.map((h, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto] sm:items-center">
              <input
                className="field" value={h.name} placeholder="Name"
                onChange={(e) => setField(i, 'name', e.target.value)}
                aria-label="Hotline name"
              />
              <input
                className="field tabular-nums" value={h.number} placeholder="Number"
                onChange={(e) => setField(i, 'number', e.target.value)}
                aria-label="Hotline number"
              />
              <input
                className="field" value={h.note ?? ''} placeholder="When it is open"
                onChange={(e) => setField(i, 'note', e.target.value)}
                aria-label="Hotline note"
              />
              <button
                onClick={() => setHotlines(hotlines.filter((_, j) => j !== i))}
                disabled={hotlines.length === 1}
                className="p-2.5 rounded-[8px] hover:bg-paper-sunk text-ink-faint disabled:opacity-40"
                aria-label="Remove"
                title={hotlines.length === 1 ? 'Keep at least one number' : 'Remove'}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setHotlines([...hotlines, { name: '', number: '', note: '' }])}
            className="btn-quiet h-9 px-4"
          >
            <Plus size={15} />
            Add a number
          </button>
          <button onClick={saveHotlines} disabled={busy} className="btn-primary h-9 px-4">
            <Check size={15} />
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      {/* 1. Configure Escalation Rules */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Siren size={17} className="text-mood-2" />
          Escalation rules
        </h2>

        <label className="label mt-4" htmlFor="threshold">
          Raise an alert above a risk score of {Number(threshold).toFixed(2)}
        </label>
        <input
          id="threshold" type="range" min={0.1} max={1} step={0.05}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          className="w-full max-w-md accent-tide-700"
        />
        <div className="flex justify-between max-w-md text-xs text-ink-faint">
          <span>0.10 — escalates almost everything</span>
          <span>1.00 — almost nothing</span>
        </div>

        <p className="mt-4 text-sm text-ink-soft leading-relaxed">
          This only affects moderate cases. High and severe risk always escalate whatever
          this is set to, and the deterministic keyword check can raise a level but never
          lower one. Turning this up cannot switch off crisis detection.
        </p>

        <button onClick={saveThreshold} disabled={busy} className="btn-primary h-9 px-4 mt-4">
          <Check size={15} />
          Save threshold
        </button>
      </section>

      {/* Evidence for tuning the number above */}
      {overview?.by_source?.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <TrendingUp size={17} className="text-tide-500" />
            Where alerts come from
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 font-semibold">Source</th>
                  <th className="py-2 font-semibold">Risk</th>
                  <th className="py-2 font-semibold text-right">Raised</th>
                  <th className="py-2 font-semibold text-right">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {overview.by_source.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 capitalize">{r.source.replace('_', ' ')}</td>
                    <td className="py-2 capitalize">{r.risk_level}</td>
                    <td className="py-2 text-right tabular-nums">{r.n}</td>
                    <td className="py-2 text-right tabular-nums">{r.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {overview?.weekly?.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <Clock size={17} className="text-tide-500" />
            Alerts by week
          </h2>
          <ul className="mt-4 space-y-2.5">
            {overview.weekly.map((w) => (
              <li key={w.week} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-ink-soft">
                  {format(parseISO(w.week), 'd MMM')}
                </span>
                <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                  <div className="h-full rounded-pill bg-mood-2"
                       style={{ width: `${(w.n / weeklyMax) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-sm tabular-nums">{w.n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
