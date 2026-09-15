import { useEffect, useState } from 'react';
import { Search, Download, FileText, ArrowLeft, BookOpen } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 32: Wellness Resources.
 *
 * Reading happens in the app; downloading is for taking something offline.
 * Both matter here — barangay connectivity is not reliable, and a resident
 * who saved a grounding exercise last week should still have it during a
 * bad night with no signal.
 */
export default function Resources() {
  const [resources, setResources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/resources/categories').then(({ categories }) => setCategories(categories)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (category) params.set('category', category);
    api(`/resources?${params}`)
      .then(({ resources }) => setResources(resources))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [q, category]);

  const read = async (id) => {
    try {
      const { resource } = await api(`/resources/${id}`);
      setOpen(resource);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    }
  };

  const download = async (id) => {
    try {
      const { download_url } = await api(`/resources/${id}/download`);
      window.open(download_url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    }
  };

  if (open) {
    return (
      <article className="space-y-5 max-w-2xl">
        <button
          onClick={() => setOpen(null)}
          className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
        >
          <ArrowLeft size={15} />
          All resources
        </button>

        <header>
          {open.category && (
            <span className="text-xs font-semibold text-tide-700 uppercase tracking-wide">
              {open.category}
            </span>
          )}
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{open.title}</h1>
          {open.description && (
            <p className="mt-2 text-ink-soft leading-relaxed">{open.description}</p>
          )}
        </header>

        {open.body && (
          <div className="text-[15px] leading-[1.75] whitespace-pre-wrap">{open.body}</div>
        )}

        {open.has_file && (
          <button onClick={() => download(open.resource_id)} className="btn-primary">
            <Download size={16} />
            Download
          </button>
        )}
      </article>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Things to read or keep, for the days between sessions.
        </p>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search resources"
          className="field pl-9"
          aria-label="Search resources"
        />
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategory('')}
            className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
              category === '' ? 'border-tide-500 bg-tide-50' : 'border-line hover:bg-paper-sunk'
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => setCategory(c.category)}
              className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
                category === c.category
                  ? 'border-tide-500 bg-tide-50'
                  : 'border-line hover:bg-paper-sunk'
              }`}
            >
              {c.category}
              <span className="ml-1.5 text-ink-faint">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : resources.length === 0 ? (
        <div className="card p-8 text-center">
          <BookOpen size={20} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-soft">
            {q || category
              ? 'Nothing matches that. Try clearing the filters.'
              : 'No resources published yet.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {resources.map((r) => (
            <li key={r.resource_id} className="card p-5 flex flex-col">
              {r.category && (
                <span className="text-xs font-semibold text-tide-700 uppercase tracking-wide">
                  {r.category}
                </span>
              )}
              <h2 className="mt-1 font-bold">{r.title}</h2>
              {r.description && (
                <p className="mt-1.5 text-sm text-ink-soft leading-relaxed flex-1">
                  {r.description}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                {r.has_body && (
                  <button onClick={() => read(r.resource_id)} className="btn-quiet h-9 px-4 text-xs">
                    <FileText size={13} />
                    Read
                  </button>
                )}
                {r.has_file && (
                  <button
                    onClick={() => download(r.resource_id)}
                    className="btn-quiet h-9 px-4 text-xs"
                  >
                    <Download size={13} />
                    Download
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
