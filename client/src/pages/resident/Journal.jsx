import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Phone, Trash2, Play, AlertCircle, Info } from 'lucide-react';
import VoiceRecorder from '../../components/VoiceRecorder.jsx';
import { api, getToken } from '../../lib/api.js';
import CrisisPanel from '../../components/CrisisPanel.jsx';

const EMOTION_TONE = {
  hopeful: 'bg-mood-5', calm: 'bg-mood-5', neutral: 'bg-mood-3',
  tired: 'bg-mood-3', anxious: 'bg-mood-2', sad: 'bg-mood-2',
  angry: 'bg-mood-1', distressed: 'bg-mood-1',
};

const RISK_LABEL = {
  low: null,
  moderate: 'Worth keeping an eye on',
  high: 'High concern',
  severe: 'Urgent concern',
};

export default function Journal() {
  const [entries, setEntries] = useState([]);
  const [trends, setTrends] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [crisis, setCrisis] = useState(null);

  const load = () => {
    api('/journals').then(({ entries }) => setEntries(entries)).catch(() => {});
    api('/journals/trends').then(setTrends).catch(() => {});
  };

  useEffect(() => {
    api('/journals/languages').then(({ languages }) => setLanguages(languages)).catch(() => {});
    load();
  }, []);

  const submit = async (blob, duration) => {
    setBusy(true);
    setError('');
    setResult(null);
    setCrisis(null);
    try {
      const body = new FormData();
      body.append('audio', blob, `entry.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
      body.append('language', language);
      body.append('duration_sec', String(duration));

      const res = await fetch('/api/journals', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Could not process the recording.');

      setResult(payload);
      // Crisis content is kept in its own state so it stays on screen even
      // if the resident scrolls or dismisses the reflection.
      if (payload.crisis) setCrisis(payload.crisis);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    await api(`/journals/${id}`, { method: 'DELETE' }).catch(() => {});
    load();
  };

  const playEntry = async (id) => {
    try {
      const { audio_url } = await api(`/journals/${id}/audio`);
      new Audio(audio_url).play();
    } catch {
      setError('Could not load that recording.');
    }
  };

  const selected = languages.find((l) => l.code === language);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Voice journal</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Say whatever is on your mind. OpenUp writes it down, notices how it sounds,
          and keeps it private to you.
        </p>
      </div>

      {/* Crisis panel: shown above everything, never auto-dismissed. */}
      {crisis && (
        <CrisisPanel
          message={crisis.message}
          hotlines={crisis.hotlines}
          contactAlerted={crisis.contact_alerted}
        />
      )}

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">New entry</h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-ink-soft">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={busy}
              className="h-9 px-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm"
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Honest about where the transcription is weaker. */}
        {selected?.quality === 'fair' && (
          <p className="mt-3 flex gap-2 text-xs text-ink-soft bg-paper-sunk rounded-[10px] px-3 py-2.5">
            <Info size={14} className="shrink-0 mt-0.5" />
            Bisaya transcription is improving but still less accurate than English or
            Filipino. Your recording is kept either way, so you can always listen back
            to what you actually said.
          </p>
        )}

        <VoiceRecorder onSubmit={submit} busy={busy} />

        {busy && (
          <p className="text-center text-sm text-ink-soft">
            Transcribing and reading your entry. This takes a few seconds.
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}
      </section>

      {/* Reflection on the entry just recorded. */}
      {result?.journal && (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${EMOTION_TONE[result.journal.emotion_result] ?? 'bg-line-strong'}`} />
            <h2 className="font-bold capitalize">{result.journal.emotion_result}</h2>
            {result.mocked && (
              <span className="ml-auto text-xs text-ink-faint">simulated analysis</span>
            )}
          </div>
          {result.low_confidence && (
            <p className="mt-3 flex gap-2 text-xs text-ink-soft bg-mood-2/10 rounded-[10px] px-3 py-2.5">
              <Info size={14} className="shrink-0 mt-0.5" />
              Some words were hard to make out, so the text below may not match what you
              said. Play the recording back to check.
            </p>
          )}
          <p className="mt-3 text-sm leading-relaxed">{result.journal.ai_reflection}</p>
          <details className="mt-4">
            <summary className="text-sm font-semibold text-tide-700 cursor-pointer">
              What we heard
            </summary>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {result.journal.transcript}
            </p>
          </details>
        </section>
      )}

      {/* Emotion trends */}
      {trends?.emotions?.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">How you have sounded lately</h2>
          <ul className="mt-4 space-y-2.5">
            {trends.emotions.map((e) => {
              const total = trends.emotions.reduce((a, x) => a + x.n, 0);
              return (
                <li key={e.emotion_result} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm capitalize text-ink-soft">
                    {e.emotion_result}
                  </span>
                  <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                    <div
                      className={`h-full rounded-pill ${EMOTION_TONE[e.emotion_result] ?? 'bg-line-strong'}`}
                      style={{ width: `${(e.n / total) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums">{e.n}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* History */}
      <section>
        <h2 className="font-bold">Past entries</h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">
            Nothing here yet. Your first entry will appear once you record one.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {entries.map((e) => (
              <li key={e.journal_id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${EMOTION_TONE[e.emotion_result] ?? 'bg-line-strong'}`} />
                      <span className="text-sm font-semibold capitalize">{e.emotion_result}</span>
                      <span className="text-xs text-ink-faint">
                        {format(parseISO(e.created_at), 'd MMM, h:mm a')}
                      </span>
                    </div>

                    {e.status === 'failed' ? (
                      <p className="mt-2 text-sm text-mood-2">
                        This entry could not be processed. The recording is still saved.
                      </p>
                    ) : e.status !== 'ready' ? (
                      <p className="mt-2 text-sm text-ink-faint">Still processing…</p>
                    ) : (
                      <p className="mt-2 text-sm text-ink-soft leading-relaxed line-clamp-3">
                        {e.transcript}
                      </p>
                    )}

                    {RISK_LABEL[e.risk_level] && (
                      <span className="mt-2 inline-block text-xs font-semibold text-mood-2">
                        {RISK_LABEL[e.risk_level]}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => playEntry(e.journal_id)}
                      className="p-2 rounded-[8px] hover:bg-paper-sunk"
                      aria-label="Play recording"
                    >
                      <Play size={15} />
                    </button>
                    <button
                      onClick={() => remove(e.journal_id)}
                      className="p-2 rounded-[8px] hover:bg-paper-sunk text-ink-faint"
                      aria-label="Delete entry"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
