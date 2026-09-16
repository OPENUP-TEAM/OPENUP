import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, ShieldAlert, UserRound, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * The crisis panel.
 *
 * One component for the assessment, the voice journal, and the AI
 * companion, so a resident sees the same options whichever path raised
 * the concern.
 *
 * It reports what is actually true about availability. If no psychologist is
 * connected, it says so and leads with the hotline rather than offering a
 * button that drops someone in distress into an empty room. Availability
 * is re-checked every 20 seconds, because "nobody is online" can stop
 * being true while the panel is open.
 */
export default function CrisisPanel({ message, hotlines: fallbackHotlines = [], contactAlerted }) {
  const navigate = useNavigate();
  const [availability, setAvailability] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const check = () =>
    api('/support/availability').then(setAvailability).catch(() => {});

  useEffect(() => {
    check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError('');
    try {
      await api('/support/connect', { method: 'POST' });
      navigate('/app/chat');
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  };

  const hotlines = availability?.hotlines?.length ? availability.hotlines : fallbackHotlines;
  const online = availability?.online_count ?? 0;
  const onDuty = availability?.on_duty_count ?? 0;

  return (
    <section className="rounded-card border-2 border-mood-1 bg-mood-1/5 p-5">
      <div className="flex gap-3">
        <ShieldAlert size={20} className="text-mood-1 shrink-0 mt-0.5" />
        <div className="min-w-0 w-full">
          <h2 className="font-bold">You do not have to sit with this alone</h2>
          <p className="mt-1.5 text-sm leading-relaxed">{message}</p>

          {/* Psychologist availability, stated plainly either way. */}
          <div className="mt-4">
            {online > 0 ? (
              <>
                <p className="text-sm font-semibold">
                  {online} psychologist{online === 1 ? ' is' : 's are'} online right now
                </p>
                {availability.psychologists?.length > 0 && (
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {availability.psychologists.map((c) => c.name).join(', ')}
                  </p>
                )}
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="btn-primary h-10 px-5 mt-3"
                >
                  {connecting ? <Loader2 size={15} className="animate-spin" /> : <UserRound size={15} />}
                  {connecting ? 'Connecting…' : 'Talk to a psychologist now'}
                </button>
              </>
            ) : onDuty > 0 ? (
              <>
                <p className="text-sm font-semibold">
                  No psychologist is online this moment
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {onDuty} {onDuty === 1 ? 'is' : 'are'} on duty and should see your message
                  shortly. The numbers below answer immediately.
                </p>
                <button
                  onClick={connect}
                  disabled={connecting}
                  className="btn-quiet h-10 px-5 mt-3"
                >
                  <UserRound size={15} />
                  {connecting ? 'Sending…' : 'Leave a message for a psychologist'}
                </button>
              </>
            ) : (
              <p className="text-sm font-semibold">
                No psychologist is available right now. Please call one of these — they
                answer any hour.
              </p>
            )}
          </div>

          <ul className="mt-4 space-y-2">
            {hotlines.map((h) => (
              <li key={h.number}>
                <a
                  href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
                  className="flex items-center gap-3 bg-paper-raised border border-line rounded-[10px] px-3.5 py-3"
                >
                  <Phone size={15} className="text-mood-1 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{h.name}</span>
                    {h.note && <span className="block text-xs text-ink-faint">{h.note}</span>}
                  </span>
                  <span className="ml-auto text-sm font-bold tabular-nums">{h.number}</span>
                </a>
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="mt-3 text-sm text-mood-1">{error}</p>
          )}

          {contactAlerted && (
            <p className="mt-3 text-xs text-ink-soft">
              Your trusted contact was recorded for follow-up.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
