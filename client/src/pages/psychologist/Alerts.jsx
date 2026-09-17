import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ShieldAlert, Hand, Check, MessageSquare, CalendarPlus, Clock, X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';

/**
 * The crisis alert queue.
 *
 * Until this existed, escalation ended in a notification linking to a page
 * that was not built, so the whole crisis path stopped at "someone has
 * been told".
 *
 * Resolving asks whether the concern was real. That answer is the only
 * ground truth in the system: without it, the effectiveness tracker cannot
 * report detection accuracy and any figure would be invented.
 */
const RISK = {
  severe:   { label: 'Severe', tone: 'text-white bg-mood-1' },
  high:     { label: 'High',   tone: 'text-mood-2 bg-mood-2/15' },
  moderate: { label: 'Moderate', tone: 'text-mood-3 bg-mood-3/15' },
  low:      { label: 'Low',    tone: 'text-ink-faint bg-paper-sunk' },
};

const OUTCOMES = [
  { key: 'session_booked',    label: 'Booked a session with them' },
  { key: 'spoke_with_them',   label: 'Spoke with them, no session needed yet' },
  { key: 'referred_elsewhere', label: 'Referred them elsewhere' },
  { key: 'could_not_reach',   label: 'Could not reach them' },
  { key: 'no_action_needed',  label: 'No action needed' },
];

export default function Alerts() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [wasReal, setWasReal] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api(`/me/psychologist/alerts?status=${status}`)
      .then(({ alerts }) => setAlerts(alerts))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  /**
   * Open a chat with the resident this alert belongs to.
   *
   * Psychologists cannot start conversations in general; an open alert is
   * the exception, and the server enforces that rather than this button.
   */
  const reachOut = async (id) => {
    setBusy(id);
    setError('');
    try {
      const r = await api(`/me/psychologist/alerts/${id}/outreach`, { method: 'POST' });
      navigate(`/psychologist/chat?c=${r.conversation_id}`);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  };

  const claim = async (id) => {
    setBusy(id);
    setError('');
    try {
      await api(`/me/psychologist/alerts/${id}/claim`, { method: 'PATCH' });
      setNotice('You are handling this one. Others will see that.');
      load();
    } catch (e) {
      setError(e.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    setBusy(resolving.alert_id);
    setError('');
    setNotice('');
    try {
      await api(`/me/psychologist/alerts/${resolving.alert_id}/resolve`, {
        method: 'PATCH',
        body: { was_real: wasReal, outcome, note: note.trim() || undefined },
      });
      setNotice('Resolved. Your judgement feeds the effectiveness figures.');
      setResolving(null);
      setWasReal(null);
      setOutcome('');
      setNote('');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Crisis alerts</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Raised by the voice journal, the companion, an assessment, a community post, or
          a barangay referral. What triggered them is not shown.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setStatus(k)}
            className={`h-9 px-4 rounded-pill text-sm font-semibold ${
              status === k ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
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

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : alerts.length === 0 ? (
        <div className="card p-8 text-center">
          <ShieldAlert size={20} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-soft">
            {status === 'open' ? 'Nothing open. ' : 'Nothing here. '}
            {status === 'open' && 'Alerts appear here the moment one is raised.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((a) => {
            const r = RISK[a.risk_level] ?? RISK.low;
            const isOpen = a.status !== 'resolved';
            const unclaimed = isOpen && !a.handled_by_name;

            return (
              <li key={a.alert_id}
                  className={`card p-5 ${a.risk_level === 'severe' && isOpen ? 'border-mood-1' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-pill ${r.tone}`}>
                        {r.label}
                      </span>
                      <span className="font-semibold">{a.resident_label}</span>
                      <span className="text-xs text-ink-faint">{a.barangay_name}</span>
                    </div>

                    <p className="mt-2 text-sm text-ink-soft capitalize">
                      From {a.source.replace('_', ' ')} ·{' '}
                      {format(parseISO(a.created_at), "d MMM 'at' h:mm a")}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {isOpen && a.days_open > 2 && (
                        <span className="flex items-center gap-1 font-semibold text-mood-2">
                          <Clock size={12} />
                          open {a.days_open} day{a.days_open === 1 ? '' : 's'}
                        </span>
                      )}
                      {a.has_upcoming_session && (
                        <span className="flex items-center gap-1 text-mood-5">
                          <CalendarPlus size={12} />
                          already has a session booked
                        </span>
                      )}
                      {a.has_open_chat && (
                        <span className="flex items-center gap-1 text-tide-700">
                          <MessageSquare size={12} />
                          open chat
                        </span>
                      )}
                      {a.handled_by_name && isOpen && (
                        <span className="text-ink-faint">
                          {a.handled_by_me ? 'you are handling this' : `${a.handled_by_name} is handling this`}
                        </span>
                      )}
                      {!isOpen && (
                        <span className={a.was_helpful ? 'text-mood-5' : 'text-ink-faint'}>
                          {a.was_helpful === true ? 'Confirmed a real concern'
                            : a.was_helpful === false ? 'Not a real concern'
                            : 'Resolved'}
                          {a.resolved_at && ` · ${format(parseISO(a.resolved_at), 'd MMM')}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 min-w-[150px]">
                    {isOpen && (
                      <>
                        <button
                          onClick={() => reachOut(a.alert_id)}
                          disabled={busy === a.alert_id}
                          className="btn-primary h-9 px-4 text-xs"
                        >
                          <MessageSquare size={13} />
                          {busy === a.alert_id
                            ? 'Opening…'
                            : a.has_open_chat ? 'Open chat' : 'Reach out'}
                        </button>
                        {unclaimed && (
                          <button onClick={() => claim(a.alert_id)}
                                  disabled={busy === a.alert_id}
                                  className="btn-quiet h-9 px-4 text-xs">
                            <Hand size={13} />
                            I will take this
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setResolving(a); setWasReal(null); setOutcome(''); setNote('');
                          }}
                          className="btn-quiet h-9 px-4 text-xs"
                        >
                          <Check size={13} />
                          Resolve
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Resolution, which is where ground truth comes from */}
      {resolving && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 px-5">
          <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold">Resolve this alert</h2>
              <button onClick={() => setResolving(null)} className="p-1" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">
              {resolving.resident_label} · {resolving.risk_level} risk from{' '}
              {resolving.source.replace('_', ' ')}
            </p>

            <span className="label mt-5">Was this a real concern?</span>
            <div className="grid grid-cols-2 gap-2">
              {[[true, 'Yes, real'], [false, 'No, false alarm']].map(([v, l]) => (
                <button
                  key={String(v)}
                  onClick={() => setWasReal(v)}
                  className={`h-11 rounded-card border text-sm font-semibold ${
                    wasReal === v ? 'border-tide-500 bg-tide-50' : 'border-line-strong'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-faint leading-relaxed">
              Answer for the concern, not the outcome. Someone genuinely in danger who
              declines a session is still a correct detection.
            </p>

            <span className="label mt-5">What happened?</span>
            <div className="space-y-2">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setOutcome(o.key)}
                  className={`w-full text-left px-3.5 h-11 rounded-card border text-sm ${
                    outcome === o.key ? 'border-tide-500 bg-tide-50' : 'border-line-strong'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <label className="label mt-5" htmlFor="note">Note (optional)</label>
            <input id="note" className="field" value={note}
                   onChange={(e) => setNote(e.target.value)} />

            <div className="mt-5 flex gap-2">
              <button
                onClick={resolve}
                disabled={wasReal === null || !outcome || busy === resolving.alert_id}
                className="btn-primary flex-1"
              >
                {busy === resolving.alert_id ? 'Saving…' : 'Resolve'}
              </button>
              <button onClick={() => setResolving(null)} className="btn-quiet px-5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
