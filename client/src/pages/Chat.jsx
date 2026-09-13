import { useEffect, useRef, useState } from 'react';
import { format, parseISO, isToday } from 'date-fns';
import {
  MessageSquarePlus, Send, ArrowLeft, EyeOff, Eye, Hand, ShieldCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { connectSocket } from '../lib/socket.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Figure 30: Anonymous Chat.
 *
 * One component for both sides. A resident starts conversations; a
 * counselor claims unassigned ones from a shared queue.
 *
 * Messages travel over Socket.IO. History comes from REST, because a
 * socket that reconnects should not replay a whole thread.
 */

const stamp = (iso) => {
  const d = parseISO(iso);
  return isToday(d) ? format(d, 'h:mm a') : format(d, 'd MMM, h:mm a');
};

export default function Chat() {
  const { user } = useAuth();
  const isResident = user?.role === 'resident';

  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [meta, setMeta] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);

  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);

  const loadList = () =>
    api('/chat/conversations')
      .then(({ conversations }) => setConversations(conversations))
      .catch((err) => setError(err.message));

  useEffect(() => { loadList(); }, []);

  // One socket for the page; the room changes as conversations change.
  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    const onMessage = (m) => {
      setMessages((prev) =>
        prev.some((p) => p.message_id === m.message_id) ? prev : [...prev, m]
      );
      loadList();
    };
    const onTyping = ({ isTyping }) => setTyping(isTyping);

    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
    };
  }, []);

  // Join the room and load history when a conversation is opened.
  useEffect(() => {
    if (!active) return;
    setMessages([]);
    setTyping(false);

    api(`/chat/conversations/${active}/messages`)
      .then(({ conversation, messages }) => {
        setMeta(conversation);
        setMessages(messages);
      })
      .catch((err) => setError(err.message));

    socketRef.current?.emit('chat:join', active, (ack) => {
      if (!ack?.ok) setError(ack?.error || 'Could not join that conversation.');
    });
  }, [active]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const startChat = async () => {
    setBusy(true);
    setError('');
    try {
      const { conversation_id } = await api('/chat/conversations', {
        method: 'POST',
        body: { is_anonymous: true },
      });
      await loadList();
      setActive(conversation_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const claim = async (id) => {
    setBusy(true);
    setError('');
    try {
      await api(`/chat/conversations/${id}/claim`, { method: 'PATCH' });
      await loadList();
      setActive(id);
    } catch (err) {
      setError(err.message);
      loadList();
    } finally {
      setBusy(false);
    }
  };

  const send = (e) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !active) return;

    socketRef.current?.emit('chat:send', { conversationId: active, content }, (ack) => {
      if (!ack?.ok) setError(ack?.error || 'Message did not send.');
    });
    setDraft('');
    socketRef.current?.emit('chat:typing', { conversationId: active, isTyping: false });
  };

  const onType = (e) => {
    setDraft(e.target.value);
    if (!active) return;
    socketRef.current?.emit('chat:typing', { conversationId: active, isTyping: true });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(
      () => socketRef.current?.emit('chat:typing', { conversationId: active, isTyping: false }),
      1500
    );
  };

  const revealName = async () => {
    try {
      await api(`/chat/conversations/${active}/anonymity`, {
        method: 'PATCH',
        body: { is_anonymous: false },
      });
      setMeta((m) => ({ ...m, is_anonymous: false }));
      loadList();
    } catch (err) {
      setError(err.message);
    }
  };

  // ------------------------------------------------------------------
  // Conversation list
  // ------------------------------------------------------------------
  if (!active) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {isResident ? 'Chat' : 'Resident chats'}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {isResident
                ? 'Message a counselor without giving your name.'
                : 'Unclaimed chats are waiting for any verified counselor.'}
            </p>
          </div>
          {isResident && (
            <button onClick={startChat} disabled={busy} className="btn-primary h-10 px-4">
              <MessageSquarePlus size={16} />
              {busy ? 'Starting…' : 'New chat'}
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}

        {conversations.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-ink-soft">
              {isResident
                ? 'No conversations yet. Starting one does not share your name.'
                : 'No chats waiting.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {conversations.map((c) => (
              <li key={c.conversation_id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => (c.unclaimed && !isResident ? null : setActive(c.conversation_id))}
                    disabled={c.unclaimed && !isResident}
                    className="text-left min-w-0 flex-1 disabled:cursor-default"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{c.title}</span>
                      {c.is_anonymous && (
                        <EyeOff size={13} className="text-ink-faint shrink-0" />
                      )}
                      {c.unread > 0 && (
                        <span className="shrink-0 text-xs font-bold bg-tide-700 text-white rounded-pill px-2 py-0.5">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft truncate">
                      {c.last_message || 'No messages yet'}
                    </p>
                    {c.last_sent_at && (
                      <p className="mt-0.5 text-xs text-ink-faint">{stamp(c.last_sent_at)}</p>
                    )}
                  </button>

                  {!isResident && c.unclaimed && (
                    <button
                      onClick={() => claim(c.conversation_id)}
                      disabled={busy}
                      className="btn-primary h-9 px-4 shrink-0"
                    >
                      <Hand size={14} />
                      Take
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Thread
  // ------------------------------------------------------------------
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-5rem)]">
      <header className="flex items-center gap-3 pb-4 border-b border-line shrink-0">
        <button
          onClick={() => { setActive(null); setMeta(null); loadList(); }}
          className="p-1.5 rounded-[8px] hover:bg-paper-sunk"
          aria-label="Back to conversations"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="font-bold truncate">{meta?.other_party ?? 'Loading…'}</p>
          <p className="text-xs text-ink-faint">
            {meta?.is_anonymous
              ? isResident ? 'Your name is hidden' : 'Resident is anonymous'
              : isResident ? 'Sharing your name' : 'Name shared'}
          </p>
        </div>
      </header>

      {/* 3. Toggle Anonymous Mode. Resident only, and one-way. */}
      {isResident && meta?.is_anonymous && (
        <div className="mt-3 flex items-center gap-3 bg-paper-sunk rounded-[10px] px-3.5 py-3 shrink-0">
          <ShieldCheck size={16} className="text-tide-500 shrink-0" />
          <p className="text-xs text-ink-soft flex-1">
            Your counselor sees only your display name. You can share your real name if
            you want to, but you cannot take it back afterwards.
          </p>
          <button onClick={revealName} className="btn-quiet h-8 px-3 text-xs shrink-0">
            <Eye size={13} />
            Share name
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-ink-faint py-8">
            {isResident
              ? 'Say whatever you need to. Nobody here knows who you are.'
              : 'No messages yet.'}
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.message_id}
              className={`flex ${m.mine || m.sender_id === user?.user_id ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[78%] rounded-card px-3.5 py-2.5 ${
                  m.mine || m.sender_id === user?.user_id
                    ? 'bg-tide-700 text-white'
                    : 'bg-paper-sunk text-ink'
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {m.content}
                </p>
                <p
                  className={`mt-1 text-[10px] ${
                    m.mine || m.sender_id === user?.user_id ? 'text-white/60' : 'text-ink-faint'
                  }`}
                >
                  {stamp(m.sent_at)}
                </p>
              </div>
            </div>
          ))
        )}

        {typing && (
          <p className="text-xs text-ink-faint italic">typing…</p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-2.5 shrink-0">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex gap-2 pt-3 border-t border-line shrink-0">
        <input
          value={draft}
          onChange={onType}
          placeholder="Write a message"
          className="field flex-1"
          aria-label="Message"
          autoComplete="off"
        />
        <button type="submit" disabled={!draft.trim()} className="btn-primary px-5">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
