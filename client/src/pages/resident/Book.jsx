import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, format, isSameDay, parseISO } from 'date-fns';
import {
  Search, ArrowLeft, Languages, Wallet, Check, CalendarX,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 33: Counseling Booking.
 *
 * Three steps rather than one long form: choosing a psychologist, choosing a
 * time, and confirming are separate decisions, and a resident who is
 * already struggling should not face all of them at once.
 */

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

export default function Book() {
  const navigate = useNavigate();
  const [step, setStep] = useState('choose'); // choose | slot | confirm
  const [psychologists, setPsychologists] = useState([]);
  const [credits, setCredits] = useState(null);
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('');

  const [selected, setSelected] = useState(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState(null);
  const [useCredit, setUseCredit] = useState(false);
  const [sessionType, setSessionType] = useState('one_on_one');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/me/credits').then(setCredits).catch(() => {});
  }, []);

  // Refetch when the filters change.
  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (language) params.set('language', language);
    api(`/psychologists?${params}`)
      .then(({ psychologists }) => setPsychologists(psychologists))
      .catch((err) => setError(err.message));
  }, [q, language]);

  const date = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);

  useEffect(() => {
    if (!selected) return;
    setSlotsLoading(true);
    setSlot(null);
    api(`/psychologists/${selected.psychologist_id}/slots?date=${format(date, 'yyyy-MM-dd')}`)
      .then(({ slots }) => setSlots(slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false));
  }, [selected, date]);

  const pick = (p) => {
    setSelected(p);
    setDayOffset(0);
    setUseCredit(credits?.available > 0);
    setStep('slot');
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/bookings', {
        method: 'POST',
        body: {
          psychologist_id: selected.psychologist_id,
          schedule: new Date(slot).toISOString(),
          session_type: sessionType,
          use_care_credit: useCredit,
        },
      });
      navigate('/app/sessions', { replace: true });
    } catch (err) {
      setError(err.message);
      // A taken slot means the list is stale, so send them back to pick again.
      if (err.status === 409) setStep('slot');
    } finally {
      setBusy(false);
    }
  };

  const languages = [...new Set(
    psychologists.flatMap((p) => (p.languages || '').split(',').map((l) => l.trim()))
  )].filter(Boolean).sort();

  // ------------------------------------------------------------------
  if (step === 'choose') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Book a session</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every psychologist here is licensed and verified by OpenUp.
          </p>
        </div>

        {credits && (
          <div className="card p-4 flex items-center gap-3">
            <Wallet size={18} className="text-tide-500 shrink-0" />
            <div className="min-w-0">
              {credits.available > 0 ? (
                <>
                  <p className="text-sm font-semibold">
                    {credits.available} Care Credit{credits.available === 1 ? '' : 's'} available
                  </p>
                  <p className="text-xs text-ink-faint">
                    Worth {peso(credits.available_value)}, funded by your barangay.
                    {credits.next_expiry &&
                      ` Earliest expires ${format(parseISO(credits.next_expiry), 'd MMM yyyy')}.`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">No Care Credits available</p>
                  <p className="text-xs text-ink-faint">
                    You can still book and pay for a session yourself.
                    {credits.reserved > 0 &&
                      ` ${credits.reserved} credit${credits.reserved === 1 ? ' is' : 's are'} held for sessions you already booked.`}
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name"
              className="field pl-9"
              aria-label="Search psychologists"
            />
          </div>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="field w-auto"
            aria-label="Filter by language"
          >
            <option value="">Any language</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}

        {psychologists.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-ink-soft">
              No psychologists match that. Try clearing the filters.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {psychologists.map((p) => (
              <li key={p.psychologist_id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-bold">{p.name}</h2>
                    {p.specialization && (
                      <p className="text-sm text-tide-700 font-medium">{p.specialization}</p>
                    )}
                    {p.languages && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-faint">
                        <Languages size={13} />
                        {p.languages}
                      </p>
                    )}
                    {p.bio && (
                      <p className="mt-2.5 text-sm text-ink-soft leading-relaxed">{p.bio}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums">{peso(p.rate_per_hour)}</p>
                    <p className="text-xs text-ink-faint">per hour</p>
                    <button onClick={() => pick(p)} className="btn-primary h-9 px-4 mt-3">
                      See times
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  if (step === 'slot') {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setStep('choose')}
          className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
        >
          <ArrowLeft size={15} />
          All psychologists
        </button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{selected.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {selected.specialization} · {peso(selected.rate_per_hour)} per hour
          </p>
        </div>

        {/* Two weeks out is enough: further ahead and people forget. */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          {Array.from({ length: 14 }, (_, i) => {
            const d = addDays(new Date(), i);
            const active = isSameDay(d, date);
            return (
              <button
                key={i}
                onClick={() => setDayOffset(i)}
                className={`shrink-0 w-14 py-2 rounded-[10px] border text-center ${
                  active ? 'border-tide-500 bg-tide-50' : 'border-line hover:bg-paper-sunk'
                }`}
              >
                <span className="block text-[10px] uppercase tracking-wide text-ink-faint">
                  {format(d, 'EEE')}
                </span>
                <span className="block text-base font-bold tabular-nums">{format(d, 'd')}</span>
              </button>
            );
          })}
        </div>

        {slotsLoading ? (
          <p className="text-sm text-ink-faint">Checking availability…</p>
        ) : slots.length === 0 ? (
          <div className="card p-8 text-center">
            <CalendarX size={20} className="mx-auto text-ink-faint" />
            <p className="mt-3 text-sm text-ink-soft">
              Nothing open on {format(date, 'EEEE d MMMM')}. Try another day.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((s) => (
              <button
                key={s}
                onClick={() => { setSlot(s); setStep('confirm'); }}
                className="h-11 rounded-[10px] border border-line-strong text-sm font-semibold tabular-nums hover:border-tide-500 hover:bg-tide-50"
              >
                {format(parseISO(s), 'h:mm a')}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <button
        onClick={() => setStep('slot')}
        className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
      >
        <ArrowLeft size={15} />
        Change time
      </button>

      <h1 className="text-2xl font-bold tracking-tight">Confirm your session</h1>

      <div className="card p-5">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-faint">Psychologist</dt>
            <dd className="font-semibold text-right">{selected.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-faint">When</dt>
            <dd className="font-semibold text-right">
              {format(parseISO(slot), "EEEE d MMMM, h:mm a")}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-faint">Length</dt>
            <dd className="font-semibold text-right">1 hour</dd>
          </div>
        </dl>

        <div className="mt-5 pt-5 border-t border-line">
          <span className="label">Session type</span>
          <div className="grid grid-cols-2 gap-2 p-1 bg-paper-sunk rounded-pill">
            {[['one_on_one', 'One on one'], ['group', 'Group']].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setSessionType(v)}
                className={`h-9 rounded-pill text-sm font-semibold ${
                  sessionType === v ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-line">
          {credits?.available > 0 ? (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useCredit}
                onChange={(e) => setUseCredit(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-tide-700"
              />
              <span>
                <span className="block text-sm font-semibold">Use a Care Credit</span>
                <span className="block text-xs text-ink-faint mt-0.5">
                  Your barangay covers this session. You have {credits.available} left.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-ink-soft">
              You have no Care Credits, so this session costs{' '}
              <strong>{peso(selected.rate_per_hour)}</strong>.
            </p>
          )}
        </div>

        <div className="mt-5 pt-5 border-t border-line flex items-baseline justify-between">
          <span className="text-sm text-ink-faint">You pay</span>
          <span className="text-2xl font-extrabold tabular-nums">
            {useCredit && credits?.available > 0 ? 'Nothing' : peso(selected.rate_per_hour)}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <button onClick={confirm} disabled={busy} className="btn-primary w-full h-12">
        <Check size={17} />
        {busy ? 'Requesting…' : 'Request this session'}
      </button>

      <p className="text-xs text-ink-faint text-center">
        {selected.name} will confirm your request. You can cancel any time before it starts.
      </p>
    </div>
  );
}
