import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, KeyRound, Pencil, Copy, Check, Building2 } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: Manage LGU Accounts.
 *
 * One account per barangay. Passwords are generated rather than chosen,
 * and shown once, so nobody sets something memorable and reuses it across
 * eighteen barangays.
 */
export default function LguAccounts() {
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ barangay_id: '', name: '', email: '' });
  const [editing, setEditing] = useState(null);
  const [credential, setCredential] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Block body on purpose: a concise arrow would return the Promise, and
  // React treats an effect's return value as a cleanup function.
  const load = () => {
    api('/users/lgu/accounts').then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/users/lgu/accounts', { method: 'POST', body: form });
      setCredential({ ...r.account, note: r.note });
      setCreating(false);
      setForm({ barangay_id: '', name: '', email: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (id, name) => {
    setError('');
    try {
      const r = await api(`/users/lgu/accounts/${id}/reset-password`, { method: 'POST' });
      setCredential({ ...r, name, barangay: '' });
    } catch (err) {
      setError(err.message);
    }
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/users/lgu/accounts/${editing.user_id}`, {
        method: 'PATCH',
        body: { name: editing.name, email: editing.email },
      });
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(credential.temp_password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">LGU accounts</h1>
          <p className="mt-1 text-sm text-ink-soft">
            One account per barangay. They use it to fund and assign Care Credits.
          </p>
        </div>
        <button onClick={() => setCreating((c) => !c)} className="btn-primary h-10 px-4">
          <Plus size={16} />
          New account
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* Shown once. Deliberately hard to miss. */}
      {credential && (
        <section className="rounded-card border-2 border-tide-500 bg-tide-50 p-5">
          <h2 className="font-bold">Temporary password</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {credential.note ?? 'Shown once. Give it to the barangay directly.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="bg-paper-raised border border-line rounded-[10px] px-4 py-2.5 font-mono text-sm">
              {credential.temp_password}
            </code>
            <button onClick={copy} className="btn-quiet h-10 px-4">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            For {credential.email}. Ask them to change it after signing in.
          </p>
          <button onClick={() => setCredential(null)} className="mt-4 text-sm font-semibold text-tide-700 underline">
            I have saved it
          </button>
        </section>
      )}

      {creating && (
        <form onSubmit={create} className="card p-5 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="b">Barangay</label>
            <select id="b" required className="field" value={form.barangay_id}
                    onChange={set('barangay_id')}>
              <option value="">Choose</option>
              {(data?.barangays_without_account ?? []).map((b) => (
                <option key={b.barangay_id} value={b.barangay_id}>{b.name}</option>
              ))}
            </select>
            {data?.barangays_without_account?.length === 0 && (
              <p className="mt-1.5 text-xs text-ink-faint">Every barangay already has one.</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="n">Account name</label>
            <input id="n" required className="field" placeholder="Barangay Lahug LGU"
                   value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="label" htmlFor="e">Email</label>
            <input id="e" type="email" required className="field"
                   placeholder="lahug.lgu@openup.ph"
                   value={form.email} onChange={set('email')} />
          </div>
          <div className="sm:col-span-3 flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="btn-quiet">
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-3">
        {(data?.accounts ?? []).map((a) => (
          <li key={a.user_id} className="card p-5">
            {editing?.user_id === a.user_id ? (
              <form onSubmit={saveEdit} className="grid gap-3 sm:grid-cols-2">
                <input className="field" value={editing.name}
                       onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <input className="field" type="email" value={editing.email}
                       onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                <div className="sm:col-span-2 flex gap-2">
                  <button type="submit" disabled={busy} className="btn-primary h-9 px-4">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="btn-quiet h-9 px-4">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 font-bold">
                    <Building2 size={15} className="text-ink-faint" />
                    {a.barangay_name}
                  </h3>
                  <p className="mt-1 text-sm text-ink-soft">{a.name} · {a.email}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {a.residents} resident{a.residents === 1 ? '' : 's'}
                    {a.plan ? ` · ${a.plan} plan` : ' · no active subscription'}
                    {' · since '}{format(parseISO(a.created_at), 'MMM yyyy')}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => setEditing({ user_id: a.user_id, name: a.name, email: a.email })}
                    className="btn-quiet h-9 px-3 text-xs"
                  >
                    <Pencil size={13} />
                    Edit
                  </button>
                  <button
                    onClick={() => resetPassword(a.user_id, a.name)}
                    className="btn-quiet h-9 px-3 text-xs"
                  >
                    <KeyRound size={13} />
                    Reset password
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {data?.barangays_without_account?.length > 0 && (
        <section>
          <h2 className="font-bold">Barangays without an account</h2>
          <p className="mt-1 text-sm text-ink-soft">
            These cannot fund or assign Care Credits to their residents yet.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.barangays_without_account.map((b) => (
              <li key={b.barangay_id} className="text-sm bg-paper-sunk rounded-pill px-3.5 py-1.5">
                {b.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
