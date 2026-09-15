import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Pencil, Trash2, Eye, EyeOff, Paperclip, Search } from 'lucide-react';
import { api, getToken } from '../../lib/api.js';

/**
 * Module: Resources Management.
 *
 * Draft and published are kept separate so an administrator can work on
 * something half-finished without a resident finding it while looking for
 * help.
 */
const EMPTY = {
  title: '', description: '', category: '', body: '', is_published: false,
};

export default function ResourcesAdmin() {
  const [resources, setResources] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // resource_id or 'new'
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    const params = new URLSearchParams({ all: 'true' });
    if (q.trim()) params.set('q', q.trim());
    api(`/resources?${params}`)
      .then(({ resources }) => setResources(resources))
      .catch((err) => setError(err.message));
  };

  useEffect(load, [q]);

  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const startEdit = async (id) => {
    if (id === 'new') {
      setForm(EMPTY);
      setFile(null);
      setEditing('new');
      return;
    }
    try {
      const { resource } = await api(`/resources/${id}`);
      setForm({
        title: resource.title,
        description: resource.description ?? '',
        category: resource.category ?? '',
        body: resource.body ?? '',
        is_published: resource.is_published,
      });
      setFile(null);
      setEditing(id);
    } catch (err) {
      setError(err.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Multipart, because a file may be attached alongside the fields.
      const body = new FormData();
      Object.entries(form).forEach(([k, v]) => body.append(k, v));
      if (file) body.append('file', file);

      const res = await fetch(
        editing === 'new' ? '/api/resources' : `/api/resources/${editing}`,
        {
          method: editing === 'new' ? 'POST' : 'PATCH',
          headers: { Authorization: `Bearer ${getToken()}` },
          body,
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Could not save.');

      setNotice(editing === 'new' ? 'Resource created.' : 'Resource updated.');
      setEditing(null);
      setForm(EMPTY);
      setFile(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async (r) => {
    setError('');
    setNotice('');
    try {
      await api(`/resources/${r.resource_id}/publish`, {
        method: 'PATCH',
        body: { is_published: !r.is_published },
      });
      setNotice(r.is_published ? 'Moved back to drafts.' : 'Published.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    try {
      await api(`/resources/${r.resource_id}`, { method: 'DELETE' });
      setNotice('Deleted.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const drafts = resources.filter((r) => !r.is_published);
  const published = resources.filter((r) => r.is_published);

  const Row = ({ r }) => (
    <li className="card p-4 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold">{r.title}</h3>
          {r.category && (
            <span className="text-xs bg-paper-sunk rounded-pill px-2.5 py-0.5">{r.category}</span>
          )}
          {r.has_file && <Paperclip size={13} className="text-ink-faint" />}
        </div>
        {r.description && (
          <p className="mt-1 text-sm text-ink-soft line-clamp-2">{r.description}</p>
        )}
        <p className="mt-1 text-xs text-ink-faint">
          {format(parseISO(r.created_at), 'd MMM yyyy')}
          {r.created_by_name && ` · ${r.created_by_name}`}
        </p>
      </div>

      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => togglePublish(r)}
          className="p-2 rounded-[8px] hover:bg-paper-sunk"
          aria-label={r.is_published ? 'Unpublish' : 'Publish'}
          title={r.is_published ? 'Move to drafts' : 'Publish'}
        >
          {r.is_published ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button
          onClick={() => startEdit(r.resource_id)}
          className="p-2 rounded-[8px] hover:bg-paper-sunk"
          aria-label="Edit"
        >
          <Pencil size={15} />
        </button>
        <button
          onClick={() => remove(r)}
          className="p-2 rounded-[8px] hover:bg-paper-sunk text-ink-faint"
          aria-label="Delete"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Only published resources appear to residents.
          </p>
        </div>
        <button onClick={() => startEdit('new')} className="btn-primary h-10 px-4">
          <Plus size={16} />
          New resource
        </button>
      </div>

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {editing && (
        <form onSubmit={save} className="card p-5 space-y-4">
          <h2 className="font-bold">
            {editing === 'new' ? 'New resource' : 'Edit resource'}
          </h2>

          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" required minLength={3} className="field"
                   value={form.title} onChange={set('title')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="category">Category</label>
              <input id="category" className="field" placeholder="Coping skills"
                     value={form.category} onChange={set('category')} />
            </div>
            <div>
              <label className="label" htmlFor="file">Attachment (optional)</label>
              <input
                id="file" type="file" className="field pt-2 text-xs"
                accept="application/pdf,image/*,audio/*,video/mp4"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="description">Short description</label>
            <input id="description" className="field"
                   placeholder="A short exercise for when anxiety spikes."
                   value={form.description} onChange={set('description')} />
          </div>

          <div>
            <label className="label" htmlFor="body">Content</label>
            <textarea
              id="body" rows={8}
              value={form.body} onChange={set('body')}
              placeholder="Write the resource here. Residents read this in the app."
              className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm leading-relaxed placeholder:text-ink-faint focus:border-tide-500"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              Either this or an attachment is required.
            </p>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.is_published}
                   onChange={set('is_published')} className="w-4 h-4 accent-tide-700" />
            <span className="text-sm font-medium">Publish immediately</span>
          </label>

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}
                    className="btn-quiet">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search all resources"
          className="field pl-9" aria-label="Search resources"
        />
      </div>

      {drafts.length > 0 && (
        <section>
          <h2 className="font-bold">Drafts</h2>
          <p className="mt-1 text-sm text-ink-soft">Not visible to residents.</p>
          <ul className="mt-3 space-y-2.5">
            {drafts.map((r) => <Row key={r.resource_id} r={r} />)}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-bold">Published</h2>
        {published.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing published yet.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {published.map((r) => <Row key={r.resource_id} r={r} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
