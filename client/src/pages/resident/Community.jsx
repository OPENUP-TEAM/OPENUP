import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  MessageSquare, Flag, Pencil, Trash2, Send, EyeOff, AlertTriangle, X,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import CrisisPanel from '../../components/CrisisPanel.jsx';

/**
 * Figure 28: Community Testimonials.
 *
 * Anonymous by default. People share things here they would not put their
 * name to, and defaulting to named posting would quietly turn a support
 * board into a place nobody uses.
 */
export default function Community() {
  const { user } = useAuth();
  // Psychologists read and reply here but do not post. The board is residents
  // speaking to each other; a psychologist's own story would change what it is.
  const isResident = user?.role === 'resident';

  const [posts, setPosts] = useState([]);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [open, setOpen] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [reason, setReason] = useState('');
  const [crisis, setCrisis] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api('/community').then(({ posts }) => setPosts(posts)).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const openPost = async (id) => {
    setOpen(id);
    setComments([]);
    try {
      const { comments } = await api(`/community/${id}/comments`);
      setComments(comments);
    } catch (e) {
      setError(e.message);
    }
  };

  const post = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/community', {
        method: 'POST',
        body: { content: draft.trim(), is_anonymous: anonymous },
      });
      setDraft('');
      if (r.crisis) setCrisis(r.crisis);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    try {
      if (editing.type === 'post') {
        await api(`/community/${editing.id}`, {
          method: 'PATCH', body: { content: editing.content.trim() },
        });
        load();
      } else {
        await api(`/community/comments/${editing.id}`, {
          method: 'PATCH', body: { content: editing.content.trim() },
        });
        openPost(open);
      }
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (type, id) => {
    if (!confirm('Delete this? It cannot be undone.')) return;
    try {
      await api(type === 'post' ? `/community/${id}` : `/community/comments/${id}`,
        { method: 'DELETE' });
      if (type === 'post' && open === id) setOpen(null);
      type === 'post' ? load() : openPost(open);
    } catch (err) {
      setError(err.message);
    }
  };

  const comment = async (e) => {
    e.preventDefault();
    try {
      await api(`/community/${open}/comments`, {
        method: 'POST', body: { content: commentDraft.trim() },
      });
      setCommentDraft('');
      openPost(open);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const report = async () => {
    try {
      await api('/community/report', {
        method: 'POST',
        body: {
          content_type: reporting.type === 'post' ? 'testimonial' : 'comment',
          content_id: reporting.id,
          reason: reason.trim(),
        },
      });
      setReporting(null);
      setReason('');
      open ? openPost(open) : load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Community</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {isResident
            ? 'Things other residents have been through. Posting here does not use your real name unless you choose to.'
            : 'What residents are sharing with each other. You can reply, and your replies show your name.'}
        </p>
      </div>

      {crisis && (
        <CrisisPanel
          message={crisis.message}
          hotlines={crisis.hotlines}
          contactAlerted={crisis.contact_alerted}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {isResident && (
      <form onSubmit={post} className="card p-5">
        <textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What has been going on? Someone reading this may need to hear it."
          className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm leading-relaxed placeholder:text-ink-faint focus:border-tide-500"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={anonymous}
                   onChange={(e) => setAnonymous(e.target.checked)}
                   className="w-4 h-4 accent-tide-700" />
            <span className="flex items-center gap-1.5 text-sm text-ink-soft">
              <EyeOff size={14} />
              Post without my name
            </span>
          </label>
          <button type="submit" disabled={draft.trim().length < 10 || busy}
                  className="btn-primary h-10 px-5">
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
      )}

      <ul className="space-y-3">
        {posts.length === 0 ? (
          <li className="card p-8 text-center text-sm text-ink-soft">
            Nothing here yet. Yours could be the first.
          </li>
        ) : posts.map((p) => (
          <li key={p.testimonial_id} className="card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{p.author}</span>
                  <span className="text-xs text-ink-faint">
                    {format(parseISO(p.created_at), 'd MMM, h:mm a')}
                  </span>
                  {p.edited && <span className="text-xs text-ink-faint">edited</span>}
                  {p.status === 'flagged' && (
                    <span className="flex items-center gap-1 text-xs text-mood-2">
                      <AlertTriangle size={12} />
                      Reported
                    </span>
                  )}
                </div>

                {editing?.type === 'post' && editing.id === p.testimonial_id ? (
                  <div className="mt-2">
                    <textarea
                      rows={3} value={editing.content}
                      onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong text-sm"
                    />
                    <div className="mt-2 flex gap-2">
                      <button onClick={saveEdit} className="btn-primary h-8 px-4 text-xs">Save</button>
                      <button onClick={() => setEditing(null)} className="btn-quiet h-8 px-4 text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap">
                    {p.content}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-4">
                  <button
                    onClick={() => (open === p.testimonial_id ? setOpen(null) : openPost(p.testimonial_id))}
                    className="flex items-center gap-1.5 text-xs font-semibold text-tide-700"
                  >
                    <MessageSquare size={13} />
                    {p.comment_count} {p.comment_count === 1 ? 'reply' : 'replies'}
                  </button>
                  {!p.is_mine && !p.i_reported && (
                    <button
                      onClick={() => { setReporting({ type: 'post', id: p.testimonial_id }); setReason(''); }}
                      className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink"
                    >
                      <Flag size={12} />
                      Report
                    </button>
                  )}
                  {p.i_reported && (
                    <span className="text-xs text-ink-faint">You reported this</span>
                  )}
                </div>
              </div>

              {p.is_mine && !editing && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditing({ type: 'post', id: p.testimonial_id, content: p.content })}
                    className="p-2 rounded-[8px] hover:bg-paper-sunk" aria-label="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove('post', p.testimonial_id)}
                    className="p-2 rounded-[8px] hover:bg-paper-sunk text-ink-faint" aria-label="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            {open === p.testimonial_id && (
              <div className="mt-4 pt-4 border-t border-line space-y-3">
                {comments.map((c) => (
                  <div key={c.comment_id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{c.author}</span>
                        <span className="text-xs text-ink-faint">
                          {format(parseISO(c.created_at), 'd MMM, h:mm a')}
                        </span>
                      </div>
                      {editing?.type === 'comment' && editing.id === c.comment_id ? (
                        <div className="mt-1.5">
                          <input
                            className="field" value={editing.content}
                            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                          />
                          <div className="mt-2 flex gap-2">
                            <button onClick={saveEdit} className="btn-primary h-8 px-4 text-xs">Save</button>
                            <button onClick={() => setEditing(null)} className="btn-quiet h-8 px-4 text-xs">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-sm leading-relaxed">{c.content}</p>
                      )}
                      {!c.is_mine && !c.i_reported && (
                        <button
                          onClick={() => { setReporting({ type: 'comment', id: c.comment_id }); setReason(''); }}
                          className="mt-1 flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
                        >
                          <Flag size={11} />
                          Report
                        </button>
                      )}
                    </div>
                    {c.is_mine && !editing && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => setEditing({ type: 'comment', id: c.comment_id, content: c.content })}
                          className="p-1.5 rounded-[6px] hover:bg-paper-sunk" aria-label="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => remove('comment', c.comment_id)}
                          className="p-1.5 rounded-[6px] hover:bg-paper-sunk text-ink-faint" aria-label="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                <form onSubmit={comment} className="flex gap-2">
                  <input
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Say something kind"
                    className="field flex-1"
                    aria-label="Reply"
                  />
                  <button type="submit" disabled={commentDraft.trim().length < 2}
                          className="btn-primary px-4">
                    <Send size={15} />
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>

      {reporting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 px-5">
          <div className="card p-6 w-full max-w-sm">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold">Report this</h2>
              <button onClick={() => setReporting(null)} className="p-1" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="mt-1.5 text-sm text-ink-soft">
              A moderator will read it. Reporting does not hide anything on its own.
            </p>
            <label className="label mt-4" htmlFor="reason">What is wrong with it?</label>
            <textarea
              id="reason" rows={3} value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This reply is cruel to someone who is struggling."
              className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong text-sm"
            />
            <button onClick={report} disabled={reason.trim().length < 5}
                    className="btn-primary w-full mt-4">
              Send report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
