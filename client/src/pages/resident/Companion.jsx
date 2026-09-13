import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Send, Phone, UserRound, X, Heart, ShieldAlert, Loader2,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 29: AI Crisis Companion.
 *
 * The companion is a stopgap, not a service. Two things are always on
 * screen regardless of what the model says: a way to reach a human, and a
 * way to reach a phone. Someone in crisis should never have to navigate to
 * find either, and should never be left talking to software because that
 * was the only option in front of them.
 */

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Filipino' },
  { code: 'ceb', label: 'Bisaya' },
];

export default function Companion() {
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useState(null);
  const [language, setLanguage] = useState('en');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');

  const [hotlines, setHotlines] = useState([]);
  const [crisis, setCrisis] = useState(null);
  const [showHotlines, setShowHotlines] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [rating, setRating] = useState(null);

  const bottomRef = useRef(null);

  useEffect(() => {
    api('/companion/support').then(({ hotlines }) => setHotlines(hotlines)).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const start = async () => {
    setError('');
    try {
      const { conversation, opening } = await api('/companion/conversations', {
        method: 'POST',
        body: { language },
      });
      setConversationId(conversation.ai_conversation_id);
      setMessages([{ role: 'assistant', content: opening, sent_at: new Date().toISOString() }]);
    } catch (err) {
      setError(err.message);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || thinking) return;

    setMessages((m) => [...m, { role: 'user', content, sent_at: new Date().toISOString() }]);
    setDraft('');
    setThinking(true);
    setError('');

    try {
      const res = await api(`/companion/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: { content },
      });
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.reply, sent_at: new Date().toISOString() },
      ]);
      // Once raised, the crisis panel stays. It is not dismissed by the
      // conversation continuing.
      if (res.crisis) setCrisis(res.crisis);
    } catch (err) {
      setError(err.message);
    } finally {
      setThinking(false);
    }
  };

  /** 3. Escalate to Licensed Psychologist. */
  const escalate = async () => {
    setEscalating(true);
    setError('');
    try {
      await api(`/companion/conversations/${conversationId}/escalate`, { method: 'POST' });
      navigate('/app/chat');
    } catch (err) {
      setError(err.message);
      setEscalating(false);
    }
  };

  const rate = async (value) => {
    setRating(value);
    await api(`/companion/conversations/${conversationId}/rate`, {
      method: 'PATCH',
      body: { rating: value },
    }).catch(() => {});
  };

  // ------------------------------------------------------------------
  if (!conversationId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companion</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Somewhere to put it down at any hour, when talking to a person feels like
            too much.
          </p>
        </div>

        <div className="card p-5">
          <Heart size={20} className="text-tide-500" />
          <h2 className="mt-3 font-bold">Before you start</h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            This is software, not a counselor. It can listen and keep you company, but it
            cannot treat you and it will not pretend otherwise. If things get heavy, it
            will help you reach a real person.
          </p>

          <label className="label mt-5" htmlFor="lang">Language</label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="field"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>

          <button onClick={start} className="btn-primary w-full mt-5">
            Start talking
          </button>
        </div>

        {/* Reachable without saying anything first. */}
        <div className="card p-5">
          <h2 className="font-bold text-sm">If you need someone now</h2>
          <ul className="mt-3 space-y-2">
            {hotlines.map((h) => (
              <li key={h.number}>
                <a
                  href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
                  className="flex items-center gap-3 bg-paper-sunk rounded-[10px] px-3.5 py-3"
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
        </div>

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
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-5rem)]">
      <header className="flex items-center justify-between gap-3 pb-3 border-b border-line shrink-0">
        <div>
          <p className="font-bold">Companion</p>
          <p className="text-xs text-ink-faint">Not a counselor</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowHotlines((s) => !s)}
            className="btn-quiet h-9 px-3 text-xs"
          >
            <Phone size={14} />
            Hotlines
          </button>
          <button
            onClick={escalate}
            disabled={escalating}
            className="btn-primary h-9 px-3 text-xs"
          >
            <UserRound size={14} />
            {escalating ? 'Connecting…' : 'Talk to a person'}
          </button>
        </div>
      </header>

      {/* Crisis panel. Raised by detection, stays until the page is left. */}
      {crisis && (
        <div className="mt-3 rounded-card border-2 border-mood-1 bg-mood-1/5 p-4 shrink-0">
          <div className="flex gap-2.5">
            <ShieldAlert size={18} className="text-mood-1 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{crisis.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={escalate} disabled={escalating} className="btn-primary h-9 px-4 text-xs">
                  <UserRound size={14} />
                  Talk to a counselor now
                </button>
                {crisis.hotlines.slice(0, 2).map((h) => (
                  <a
                    key={h.number}
                    href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
                    className="btn-quiet h-9 px-4 text-xs"
                  >
                    <Phone size={13} />
                    {h.name} {h.number}
                  </a>
                ))}
              </div>
              {crisis.contact_alerted && (
                <p className="mt-2.5 text-xs text-ink-soft">
                  Your trusted contact has been recorded for follow-up.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {showHotlines && (
        <div className="mt-3 card p-4 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm">Someone you can call</h2>
            <button onClick={() => setShowHotlines(false)} className="p-1" aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {hotlines.map((h) => (
              <li key={h.number}>
                <a
                  href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
                  className="flex items-center gap-2.5 text-sm py-1.5"
                >
                  <Phone size={13} className="text-mood-1" />
                  <span className="font-medium">{h.name}</span>
                  <span className="ml-auto font-bold tabular-nums">{h.number}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-card px-3.5 py-2.5 ${
                m.role === 'user' ? 'bg-tide-700 text-white' : 'bg-paper-sunk text-ink'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {m.content}
              </p>
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="bg-paper-sunk rounded-card px-3.5 py-2.5">
              <Loader2 size={15} className="animate-spin text-ink-faint" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-2.5 shrink-0">
          {error}
        </p>
      )}

      {/* Rating feeds the AI Effectiveness Tracker. */}
      {messages.length > 6 && rating === null && (
        <div className="flex items-center gap-2 py-2 shrink-0">
          <span className="text-xs text-ink-faint">Is this helping?</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => rate(n)}
              className="w-7 h-7 rounded-full border border-line-strong text-xs font-semibold hover:bg-paper-sunk"
            >
              {n}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={send} className="flex gap-2 pt-3 border-t border-line shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say whatever comes out"
          className="field flex-1"
          aria-label="Message"
          autoComplete="off"
          disabled={thinking}
        />
        <button type="submit" disabled={!draft.trim() || thinking} className="btn-primary px-5">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
