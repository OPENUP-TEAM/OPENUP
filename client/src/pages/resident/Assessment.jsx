import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  ArrowLeft, ArrowRight, Phone, ShieldAlert, ClipboardCheck,
  TrendingDown, TrendingUp, Minus,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import CrisisPanel from '../../components/CrisisPanel.jsx';

/**
 * Figure 31: Mental Health Assessment.
 *
 * One question per screen. A grid of nine questions with four columns
 * invites people to pattern-match down a column, and answering carelessly
 * produces a score that means nothing. One at a time is slower and more
 * honest.
 */
export default function Assessment() {
  const [instruments, setInstruments] = useState([]);
  const [active, setActive] = useState(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/assessments').then(({ instruments }) => setInstruments(instruments)).catch(() => {});
  }, []);

  const start = async (key) => {
    setError('');
    try {
      const { instrument } = await api(`/assessments/${key}`);
      setActive(instrument);
      setAnswers(Array(instrument.items.length).fill(null));
      setStep(0);
      setResult(null);
      const h = await api(`/assessments/${key}/history`).catch(() => null);
      setHistory(h);
    } catch (err) {
      setError(err.message);
    }
  };

  const answer = (value) => {
    const next = [...answers];
    next[step] = value;
    setAnswers(next);
    // Move on automatically; the last question waits for Submit.
    if (step < active.items.length - 1) setTimeout(() => setStep(step + 1), 150);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/assessments/${active.key}/submit`, {
        method: 'POST',
        body: { answers },
      });
      setResult(r);
      const h = await api(`/assessments/${active.key}/history`).catch(() => null);
      setHistory(h);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setActive(null);
    setResult(null);
    setAnswers([]);
    setStep(0);
  };

  // ------------------------------------------------------------------
  // Results
  // ------------------------------------------------------------------
  if (result) {
    const pct = (result.score / result.max_score) * 100;
    const TrendIcon =
      history?.trend === 'improving' ? TrendingDown
      : history?.trend === 'worse' ? TrendingUp
      : Minus;

    return (
      <div className="space-y-6 max-w-2xl">
        {/* Crisis panel first, above the score. */}
        {result.crisis && (
          <CrisisPanel
            message={result.crisis.message}
            hotlines={result.crisis.hotlines}
            contactAlerted={result.crisis.contact_alerted}
          />
        )}

        <div className="card p-6">
          <p className="text-sm text-ink-soft">{active.name}</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-5xl font-extrabold tracking-tight tabular-nums">
              {result.score}
            </span>
            <span className="text-lg text-ink-faint">of {result.max_score}</span>
          </div>
          <p className="mt-1 text-lg font-bold">{result.result}</p>

          <div className="mt-4 h-2 rounded-pill bg-paper-sunk overflow-hidden">
            <div
              className={`h-full rounded-pill ${
                pct < 20 ? 'bg-mood-5' : pct < 40 ? 'bg-mood-4'
                : pct < 60 ? 'bg-mood-3' : pct < 75 ? 'bg-mood-2' : 'bg-mood-1'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <p className="mt-5 text-[15px] leading-relaxed">{result.guidance}</p>

          {/* Said plainly, because people read a number like this as a verdict. */}
          <p className="mt-5 text-xs text-ink-faint leading-relaxed border-t border-line pt-4">
            This is a screening questionnaire, not a diagnosis. Only a licensed
            professional can tell you what is going on, and a score on its own cannot.
          </p>
        </div>

        {result.suggest_booking && !result.crisis && (
          <div className="card p-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-soft">
              Talking this through with someone would be a reasonable next step.
            </p>
            <Link to="/app/book" className="btn-primary h-10 px-5">Book a session</Link>
          </div>
        )}

        {history?.history?.length > 1 && (
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-bold">
              <TrendIcon size={16} className="text-tide-500" />
              Compared to last time
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {history.trend === 'improving'
                ? 'Your score came down since your last check-in.'
                : history.trend === 'worse'
                  ? 'Your score went up since your last check-in.'
                  : 'Your score is about the same as last time.'}
            </p>
            <ul className="mt-4 space-y-2">
              {history.history.slice(0, 6).map((h) => (
                <li key={h.assessment_id} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-ink-faint">
                    {format(parseISO(h.taken_at), 'd MMM')}
                  </span>
                  <div className="flex-1 h-1.5 rounded-pill bg-paper-sunk overflow-hidden">
                    <div
                      className="h-full rounded-pill bg-tide-500"
                      style={{ width: `${(h.score / h.max_score) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums">{h.score}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button onClick={reset} className="btn-quiet">Back to check-ins</button>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Questions
  // ------------------------------------------------------------------
  if (active) {
    const last = step === active.items.length - 1;
    const answered = answers.filter((a) => a !== null).length;

    return (
      <div className="max-w-xl space-y-6">
        <button
          onClick={reset}
          className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
        >
          <ArrowLeft size={15} />
          Cancel
        </button>

        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">{active.name}</p>
            <p className="text-sm text-ink-faint tabular-nums">
              {step + 1} of {active.items.length}
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-pill bg-paper-sunk overflow-hidden">
            <div
              className="h-full rounded-pill bg-tide-500 transition-all"
              style={{ width: `${(answered / active.items.length) * 100}%` }}
            />
          </div>
        </div>

        <p className="text-sm text-ink-soft">{active.lead_in}</p>
        <h1 className="text-xl font-bold leading-snug">{active.items[step]}</h1>

        <div className="space-y-2">
          {active.options.map((o) => (
            <button
              key={o.value}
              onClick={() => answer(o.value)}
              className={`w-full text-left px-4 h-12 rounded-card border text-sm font-medium transition-colors ${
                answers[step] === o.value
                  ? 'border-tide-500 bg-tide-50'
                  : 'border-line-strong hover:bg-paper-sunk'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="btn-quiet">
              <ArrowLeft size={15} />
              Back
            </button>
          )}
          {last ? (
            <button
              onClick={submit}
              disabled={answers.some((a) => a === null) || busy}
              className="btn-primary flex-1"
            >
              {busy ? 'Scoring…' : 'See my results'}
            </button>
          ) : (
            <button
              onClick={() => setStep(step + 1)}
              disabled={answers[step] === null}
              className="btn-quiet ml-auto"
            >
              Next
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Pick an instrument
  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Check-in</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A few questions about the last two weeks. Your answers are private to you.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {instruments.map((i) => (
          <li key={i.key} className="card p-5 flex flex-col">
            <ClipboardCheck size={20} className="text-tide-500" />
            <h2 className="mt-3 font-bold">{i.name}</h2>
            <p className="mt-1.5 text-sm text-ink-soft leading-relaxed flex-1">
              {i.description}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              {i.formal_name} · about {Math.ceil(i.items?.length ?? 9 / 2)} minutes
            </p>
            <button onClick={() => start(i.key)} className="btn-primary h-10 mt-4">
              Start
            </button>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-faint leading-relaxed">
        These are standard screening questionnaires used in clinics worldwide. They can
        show whether something is worth talking to someone about. They cannot diagnose
        you, and a score is not a label.
      </p>
    </div>
  );
}
