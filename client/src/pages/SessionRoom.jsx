import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  ArrowLeft, NotebookPen, Siren, Phone, X, Loader2, MicOff,
} from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Figure 35: Counseling Session.
 *
 * One component for both sides. The notes panel and the escalation button
 * render only for the psychologist; the resident sees the call alone.
 *
 * Audio-first by design. The module is "Join Audio Session", video costs
 * bandwidth many barangay residents do not have, and talking about mental
 * health is easier without a camera on. Video can still be switched on
 * from inside the call.
 */

const JITSI_SCRIPT_ID = 'jitsi-external-api';

/** Loads the Jitsi external API once and reuses it afterwards. */
function loadJitsiScript(domain) {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) return resolve();

    const existing = document.getElementById(JITSI_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('load failed')));
      return;
    }

    const script = document.createElement('script');
    script.id = JITSI_SCRIPT_ID;
    script.src = `https://${domain}/external_api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Could not load the video service. Check your connection.'));
    document.body.appendChild(script);
  });
}

export default function SessionRoom({ kind = 'booking' }) {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(true);

  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [hotlines, setHotlines] = useState(null);

  const isGroup = kind === 'group';
  const isPsychologist = session?.role === 'psychologist';
  const backTo = isGroup
    ? (isPsychologist ? '/psychologist/groups' : '/app/groups')
    : (isPsychologist ? '/psychologist/requests' : '/app/sessions');

  // 1. Fetch room details. The server decides whether this is joinable.
  useEffect(() => {
    api(isGroup ? `/groups/${bookingId}/room` : `/sessions/${bookingId}`)
      .then(setSession)
      .catch((err) => { setError(err.message); setConnecting(false); });
  }, [bookingId, isGroup]);

  // 2. Start Jitsi once we have them.
  useEffect(() => {
    if (!session || !containerRef.current) return;
    let disposed = false;

    (async () => {
      try {
        await loadJitsiScript(session.domain);
        if (disposed) return;

        const api = new window.JitsiMeetExternalAPI(session.domain, {
          roomName: session.room_name,
          parentNode: containerRef.current,
          userInfo: { displayName: session.display_name },
          configOverwrite: {
            startWithVideoMuted: true,
            startWithAudioMuted: false,
            prejoinPageEnabled: false,
            disableDeepLinking: true,
            // Anyone arriving without a booking waits for admittance.
            enableLobbyChat: false,
            requireDisplayName: false,
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            DISABLE_VIDEO_BACKGROUND: true,
            TOOLBAR_BUTTONS: [
              'microphone', 'camera', 'hangup', 'chat',
              'raisehand', 'tileview', 'settings', 'videoquality',
            ],
          },
        });

        apiRef.current = api;

        api.addEventListener('videoConferenceJoined', () => setConnecting(false));
        api.addEventListener('readyToClose', () => navigate(backTo, { replace: true }));

        // 2. In-Session Messaging is Jitsi's own chat, so it stays inside
        // the encrypted call rather than being stored on our server.
      } catch (err) {
        if (!disposed) { setError(err.message); setConnecting(false); }
      }
    })();

    return () => {
      disposed = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, [session, navigate, backTo]);

  // 3. Notes, psychologist only.
  useEffect(() => {
    if (!isPsychologist || isGroup) return;
    api(`/sessions/${bookingId}/notes`)
      .then(({ notes }) => setNotes(notes))
      .catch(() => {});
  }, [isPsychologist, bookingId, isGroup]);

  const saveNote = async () => {
    if (!draft.trim()) return;
    setSavingNote(true);
    try {
      const { note } = await api(`/sessions/${bookingId}/notes`, {
        method: 'POST',
        body: { content: draft.trim() },
      });
      setNotes((n) => [...n, note]);
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNote(false);
    }
  };

  // 4. Escalate to Emergency Services.
  const escalate = async () => {
    setEscalating(true);
    try {
      const result = await api(`/sessions/${bookingId}/escalate`, {
        method: 'POST',
        body: { severity: 'severe', note: escalateNote.trim() || undefined },
      });
      setHotlines(result.hotlines);
      setEscalateOpen(false);
      setEscalateNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setEscalating(false);
    }
  };

  // ------------------------------------------------------------------
  if (error && !session) {
    return (
      <div className="min-h-screen grid place-items-center px-5">
        <div className="max-w-sm text-center">
          <MicOff size={24} className="mx-auto text-ink-faint" />
          <h1 className="mt-4 text-lg font-bold">Cannot join this session</h1>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{error}</p>
          <button onClick={() => navigate(backTo)} className="btn-primary h-10 px-5 mt-6">
            Back to sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-ink">
      {/* Header stays visible so leaving never means hunting for a button. */}
      <header className="flex items-center justify-between gap-3 px-4 h-14 shrink-0">
        <button
          onClick={() => navigate(backTo)}
          className="flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white"
        >
          <ArrowLeft size={16} />
          Leave
        </button>

        <div className="text-center min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {session?.other_party ?? 'Connecting…'}
          </p>
          {session && (
            <p className="text-xs text-white/50">
              {format(parseISO(session.schedule), 'h:mm a')} · {session.duration_min} min
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {isPsychologist && !isGroup && (
            <>
              <button
                onClick={() => setNotesOpen((o) => !o)}
                className="p-2 rounded-[8px] text-white/80 hover:bg-white/10"
                aria-label="Session notes"
              >
                <NotebookPen size={18} />
              </button>
              <button
                onClick={() => setEscalateOpen(true)}
                className="p-2 rounded-[8px] text-mood-1 hover:bg-mood-1/20"
                aria-label="Escalate to emergency support"
              >
                <Siren size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="relative flex-1">
          {connecting && (
            <div className="absolute inset-0 grid place-items-center z-10 bg-ink">
              <div className="text-center">
                <Loader2 size={24} className="mx-auto text-white/60 animate-spin" />
                <p className="mt-3 text-sm text-white/60">Connecting you to the room…</p>
                <p className="mt-1 text-xs text-white/40">
                  Your camera stays off unless you turn it on.
                </p>
              </div>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>

        {/* Notes panel: psychologist only, alongside the call rather than over it. */}
        {isPsychologist && !isGroup && notesOpen && (
          <aside className="w-full max-w-sm shrink-0 bg-paper border-l border-line flex flex-col">
            <div className="flex items-center justify-between px-4 h-12 border-b border-line">
              <h2 className="font-bold text-sm">Session notes</h2>
              <button
                onClick={() => setNotesOpen(false)}
                className="p-1.5 rounded-[6px] hover:bg-paper-sunk"
                aria-label="Close notes"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {notes.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  Nothing yet. Notes are saved against this session and visible only to you.
                </p>
              ) : (
                notes.map((n) => (
                  <div key={n.note_id} className="card p-3">
                    <p className="text-xs text-ink-faint">
                      {format(parseISO(n.created_at), 'h:mm a')}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                      {n.content}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-line">
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What stood out in this session?"
                className="w-full px-3 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm placeholder:text-ink-faint focus:border-tide-500"
              />
              <button
                onClick={saveNote}
                disabled={!draft.trim() || savingNote}
                className="btn-primary w-full h-9 mt-2"
              >
                {savingNote ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Escalation confirmation. Deliberately a second step: raising an
          alert notifies administrators and starts a real response. */}
      {escalateOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 px-5">
          <div className="card p-6 w-full max-w-md">
            <Siren size={22} className="text-mood-1" />
            <h2 className="mt-3 text-lg font-bold">Escalate to emergency support</h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              This raises a crisis alert for this resident, notifies administrators, and
              records that you are handling it. Use it when someone is in immediate danger.
            </p>

            <label className="label mt-5" htmlFor="escalate-note">
              What is happening? (optional)
            </label>
            <textarea
              id="escalate-note"
              rows={3}
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
              className="w-full px-3 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm focus:border-tide-500"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Saved to this session's notes.
            </p>

            <div className="mt-5 flex gap-2">
              <button
                onClick={escalate}
                disabled={escalating}
                className="btn-primary flex-1 bg-mood-1 hover:bg-mood-1/90"
              >
                {escalating ? 'Raising alert…' : 'Raise alert'}
              </button>
              <button onClick={() => setEscalateOpen(false)} className="btn-quiet px-5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hotlines after escalating. Stays until dismissed by hand. */}
      {hotlines && (
        <div className="fixed bottom-4 right-4 z-50 w-full max-w-xs">
          <div className="card border-2 border-mood-1 p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold text-sm">Emergency numbers</h2>
              <button
                onClick={() => setHotlines(null)}
                className="p-1 rounded-[6px] hover:bg-paper-sunk"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {hotlines.map((h) => (
                <li key={h.number}>
                  <a
                    href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
                    className="flex items-center gap-2.5 bg-paper-sunk rounded-[10px] px-3 py-2.5"
                  >
                    <Phone size={14} className="text-mood-1 shrink-0" />
                    <span className="text-xs font-semibold min-w-0 truncate">{h.name}</span>
                    <span className="ml-auto text-xs font-bold tabular-nums">{h.number}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-faint">
              Administrators have been notified.
            </p>
          </div>
        </div>
      )}

      {error && session && (
        <p role="alert" className="fixed bottom-4 left-4 z-50 text-sm bg-mood-1 text-white rounded-[10px] px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  );
}
