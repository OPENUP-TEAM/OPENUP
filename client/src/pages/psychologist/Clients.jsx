import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Search, ArrowLeft, NotebookPen, ShieldAlert, Clock, Wallet, EyeOff,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 38: Client Management.
 *
 * Clients appear under their display alias unless they chose to share
 * their name. A psychologist does not need a legal name to remember who
 * they spoke to on Tuesday, and the resident picked that alias precisely
 * so they could ask for help without being identified.
 */
const STATUS = {
  pending:   'Pending',
  confirmed: 'Confirmed',
  declined:  'Declined',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show:   'Missed',
};

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const loadList = () => {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    api(`/me/psychologist/clients${params}`)
      .then(({ clients }) => setClients(clients))
      .catch((e) => setError(e.message));
  };

  useEffect(() => { loadList(); }, [q]);

  const openClient = async (id) => {
    setOpen(id);
    setDetail(null);
    setError('');
    try {
      setDetail(await api(`/me/psychologist/clients/${id}`));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e.message);
    }
  };

  const addNote = async (bookingId) => {
    const content = (drafts[bookingId] ?? '').trim();
    if (!content) return;
    setBusy(bookingId);
    setError('');
    try {
      await api(`/me/psychologist/clients/${open}/notes`, {
        method: 'POST',
        body: { booking_id: bookingId, content },
      });
      setDrafts({ ...drafts, [bookingId]: '' });
      setDetail(await api(`/me/psychologist/clients/${open}`));
      loadList();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------------
  if (open && detail) {
    const c = detail.client;
    const openAlerts = detail.alerts.filter((a) => a.status !== 'resolved');

    return (
      <div className="space-y-6 max-w-2xl">
        <button
          onClick={() => { setOpen(null); setDetail(null); }}
          className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
        >
          <ArrowLeft size={15} />
          All clients
        </button>

        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {c.label}
            {!c.name_shared && <EyeOff size={16} className="text-ink-faint" />}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {c.barangay_name}
            {!c.name_shared && ' · has not shared their real name'}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
            {error}
          </p>
        )}

        {/* Risk first. Everything else is history. */}
        {openAlerts.length > 0 && (
          <section className="rounded-card border-2 border-mood-1 bg-mood-1/5 p-5">
            <div className="flex gap-3">
              <ShieldAlert size={19} className="text-mood-1 shrink-0 mt-0.5" />
              <div>
                <h2 className="font-bold">
                  {openAlerts.length} unresolved crisis alert
                  {openAlerts.length === 1 ? '' : 's'}
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {openAlerts.map((a) => (
                    <li key={a.alert_id}>
                      {a.risk_level} risk from {a.source.replace('_', ' ')},{' '}
                      {format(parseISO(a.created_at), 'd MMM')}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-xs text-ink-soft">
                  What triggered these is not shown. It stays theirs until they choose
                  to talk about it.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* 2. View Session History, 3. Add Progress Notes */}
        <section>
          <h2 className="font-bold">Sessions</h2>
          {detail.sessions.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">No sessions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {detail.sessions.map((s) => (
                <li key={s.booking_id} className="card p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Clock size={14} className="text-ink-faint" />
                      {format(parseISO(s.schedule), "EEE d MMM yyyy, h:mm a")}
                    </p>
                    <span className="text-xs text-ink-faint">
                      {STATUS[s.status] ?? s.status} · {s.duration_min} min
                      {s.covered_by_credit && ' · Care Credit'}
                    </span>
                  </div>

                  {s.notes.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {s.notes.map((n) => (
                        <li key={n.note_id} className="bg-paper-sunk rounded-[10px] px-3.5 py-3">
                          <p className="text-xs text-ink-faint">
                            {format(parseISO(n.created_at), 'd MMM, h:mm a')}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                            {n.content}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Notes only on sessions that happened. */}
                  {['completed', 'no_show', 'confirmed'].includes(s.status) && (
                    <div className="mt-3">
                      <textarea
                        rows={2}
                        value={drafts[s.booking_id] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [s.booking_id]: e.target.value })}
                        placeholder="What stood out in this session?"
                        className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm placeholder:text-ink-faint focus:border-tide-500"
                      />
                      <button
                        onClick={() => addNote(s.booking_id)}
                        disabled={!(drafts[s.booking_id] ?? '').trim() || busy === s.booking_id}
                        className="btn-quiet h-9 px-4 mt-2 text-xs"
                      >
                        <NotebookPen size={13} />
                        {busy === s.booking_id ? 'Saving…' : 'Add note'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Residents who have booked with you. Notes you write are visible only to you.
        </p>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients"
          className="field pl-9" aria-label="Search clients"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-soft">
            {q ? 'Nobody matches that.' : 'No residents have booked with you yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {clients.map((c) => (
            <li key={c.user_id}>
              <button
                onClick={() => openClient(c.user_id)}
                className="card p-4 w-full text-left hover:border-line-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      {c.label}
                      {!c.name_shared && <EyeOff size={13} className="text-ink-faint" />}
                      {c.open_alerts > 0 && (
                        <span className="text-xs font-bold text-white bg-mood-1 rounded-pill px-2 py-0.5">
                          {c.open_alerts} alert{c.open_alerts === 1 ? '' : 's'}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {c.barangay_name} · {c.completed} completed
                      {c.missed > 0 && ` · ${c.missed} missed`}
                      {c.note_count > 0 && ` · ${c.note_count} note${c.note_count === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  <div className="text-right shrink-0 text-xs">
                    {c.next_session ? (
                      <>
                        <p className="font-semibold text-tide-700">Next session</p>
                        <p className="text-ink-faint">
                          {format(parseISO(c.next_session), 'EEE d MMM, h:mm a')}
                        </p>
                      </>
                    ) : c.last_seen ? (
                      <>
                        <p className="text-ink-faint">Last seen</p>
                        <p className="text-ink-soft">
                          {format(parseISO(c.last_seen), 'd MMM yyyy')}
                        </p>
                      </>
                    ) : (
                      <p className="text-ink-faint">No completed sessions</p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
