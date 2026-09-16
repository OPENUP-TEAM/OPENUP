import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, X, Flag, MessageSquare, FileText } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: Community Testimonials Moderation.
 *
 * Reported content stays visible until a person decides. Auto-hiding on
 * report would let anyone silence a post they disliked, which on a mental
 * health board means silencing someone who was struggling in public.
 */
const TABS = [
  { key: 'pending', label: 'To review' },
  { key: 'kept',    label: 'Kept' },
  { key: 'removed', label: 'Removed' },
];

export default function Moderation() {
  const [tab, setTab] = useState('pending');
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState('');

  const load = () => {
    setLoading(true);
    api(`/community/moderation/queue?status=${tab}`)
      .then(({ flags }) => setFlags(flags))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [tab]);

  const decide = async (flagId, decision) => {
    setBusyId(flagId);
    setError('');
    setNotice('');
    try {
      await api(`/community/moderation/${flagId}`, {
        method: 'PATCH',
        body: { decision, note: note.trim() || undefined },
      });
      setNotice(decision === 'keep' ? 'Content kept and reports cleared.' : 'Content removed.');
      setNoteFor(null);
      setNote('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Moderation</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Reported posts and replies. One decision settles every report against the same
          piece of content.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-9 px-4 rounded-pill text-sm font-semibold ${
              tab === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
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
      ) : flags.length === 0 ? (
        <div className="card p-8 text-center">
          <Flag size={20} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-soft">
            {tab === 'pending' ? 'Nothing waiting for review.' : `Nothing ${tab}.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {flags.map((f) => (
            <li key={f.flag_id} className="card p-5">
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                {f.content_type === 'testimonial'
                  ? <FileText size={13} /> : <MessageSquare size={13} />}
                {f.content_type === 'testimonial' ? 'Post' : 'Reply'}
                <span>·</span>
                by {f.author_alias || f.author_name}
                <span>·</span>
                {format(parseISO(f.created_at), 'd MMM, h:mm a')}
                {f.report_count > 1 && (
                  <>
                    <span>·</span>
                    <span className="font-semibold text-mood-2">
                      {f.report_count} reports
                    </span>
                  </>
                )}
              </div>

              {/* The content itself, quoted rather than paraphrased, since a
                  moderator has to judge what was actually written. */}
              <blockquote className="mt-3 border-l-2 border-line-strong pl-4 text-[15px] leading-relaxed whitespace-pre-wrap">
                {f.content}
              </blockquote>

              <div className="mt-4 bg-paper-sunk rounded-[10px] px-3.5 py-3">
                <p className="text-xs font-semibold text-ink-soft">
                  Reported by {f.reporter_alias || 'a resident'}
                </p>
                <p className="mt-1 text-sm">{f.reason}</p>
              </div>

              {f.status === 'pending' ? (
                <>
                  {noteFor === f.flag_id && (
                    <div className="mt-4">
                      <label className="label" htmlFor={`note-${f.flag_id}`}>
                        Note to the author (optional)
                      </label>
                      <input
                        id={`note-${f.flag_id}`} className="field" value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="This breaks the rule about respecting other residents."
                      />
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => decide(f.flag_id, 'keep')}
                      disabled={busyId === f.flag_id}
                      className="btn-quiet h-9 px-4"
                    >
                      <Check size={15} />
                      Keep it
                    </button>
                    <button
                      onClick={() =>
                        noteFor === f.flag_id
                          ? decide(f.flag_id, 'remove')
                          : (setNoteFor(f.flag_id), setNote(''))
                      }
                      disabled={busyId === f.flag_id}
                      className="btn-primary h-9 px-4 bg-mood-1 hover:bg-mood-1/90"
                    >
                      <X size={15} />
                      {noteFor === f.flag_id ? 'Confirm removal' : 'Remove'}
                    </button>
                    {noteFor === f.flag_id && (
                      <button onClick={() => setNoteFor(null)} className="btn-quiet h-9 px-4">
                        Cancel
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-xs text-ink-faint">
                  {f.status === 'kept' ? 'Kept' : 'Removed'}
                  {f.reviewed_by_name && ` by ${f.reviewed_by_name}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
