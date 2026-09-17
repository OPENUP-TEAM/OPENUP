import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Settings as Cog, Shield, Wrench, ScrollText, RotateCcw, Check,
  AlertTriangle, Play, Database,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: System Settings.
 *
 * Four tabs rather than one long page, because they are read at different
 * times: configuration when something needs changing, roles when someone
 * joins, maintenance when something looks wrong, and the audit log when
 * someone asks who did what.
 */
const TABS = [
  { key: 'config',      label: 'Configuration', icon: Cog },
  { key: 'roles',       label: 'Roles',         icon: Shield },
  { key: 'maintenance', label: 'Maintenance',   icon: Wrench },
  { key: 'audit',       label: 'Audit log',     icon: ScrollText },
];

const ROLES = ['resident', 'psychologist', 'lgu', 'admin'];

export default function SettingsPage() {
  const [tab, setTab] = useState('config');
  const [settings, setSettings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [roles, setRoles] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditFilter, setAuditFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);

  const loadConfig = () =>
    api('/settings').then(({ settings }) => {
      setSettings(settings);
      setDrafts(Object.fromEntries(
        settings.map((s) => [s.key, JSON.stringify(s.value, null, 2)])
      ));
    }).catch((e) => setError(e.message));

  useEffect(() => {
    setError('');
    if (tab === 'config') loadConfig();
    if (tab === 'roles') api('/settings/roles/permissions').then(setRoles).catch((e) => setError(e.message));
    if (tab === 'maintenance') api('/settings/maintenance').then(setMaintenance).catch((e) => setError(e.message));
    if (tab === 'audit') {
      const qs = auditFilter ? `?action=${auditFilter}` : '';
      api(`/settings/audit${qs}`).then(setAudit).catch((e) => setError(e.message));
    }
  }, [tab, auditFilter]);

  const save = async (key) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      let value;
      try {
        value = JSON.parse(drafts[key]);
      } catch {
        throw new Error('That is not valid JSON. Check the commas and brackets.');
      }
      await api(`/settings/${key}`, { method: 'PUT', body: { value } });
      setNotice('Saved. The change is live now.');
      loadConfig();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const reset = async (key) => {
    setBusy(key);
    try {
      await api(`/settings/${key}`, { method: 'DELETE' });
      setNotice('Back to the built-in default.');
      loadConfig();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const runTask = async (task) => {
    setBusy(task);
    setError('');
    setNotice('');
    try {
      const r = await api('/settings/maintenance/run', { method: 'POST', body: { task } });
      setNotice(`Done. ${r.affected} row${r.affected === 1 ? '' : 's'} updated.`);
      api('/settings/maintenance').then(setMaintenance).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const TASK_FOR = {
    'expired subscriptions still active': 'expire_subscriptions',
    'credits past expiry still available': 'expire_credits',
    'journals stuck mid-pipeline': 'fail_stuck_journals',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System settings</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every change here is recorded in the audit log with your name against it.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 h-9 px-4 rounded-pill text-sm font-semibold ${
              tab === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
            }`}
          >
            <Icon size={15} />
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

      {/* 1. Manage Configurations */}
      {tab === 'config' && (
        <ul className="space-y-4">
          {settings.map((s) => (
            <li key={s.key} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold">{s.label}</h2>
                  <p className="mt-1 text-sm text-ink-soft leading-relaxed">{s.help}</p>
                </div>
                {s.is_default ? (
                  <span className="text-xs bg-paper-sunk rounded-pill px-2.5 py-1 shrink-0">
                    Using default
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint shrink-0">
                    {s.updated_by_name && `${s.updated_by_name}, `}
                    {s.updated_at && format(parseISO(s.updated_at), 'd MMM yyyy')}
                  </span>
                )}
              </div>

              <textarea
                rows={Math.min(14, (drafts[s.key]?.split('\n').length ?? 3) + 1)}
                value={drafts[s.key] ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                spellCheck={false}
                className="mt-4 w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-sunk font-mono text-xs leading-relaxed focus:border-tide-500"
              />

              <div className="mt-3 flex gap-2">
                <button onClick={() => save(s.key)} disabled={busy === s.key}
                        className="btn-primary h-9 px-4">
                  <Check size={15} />
                  {busy === s.key ? 'Saving…' : 'Save'}
                </button>
                {!s.is_default && (
                  <button onClick={() => reset(s.key)} disabled={busy === s.key}
                          className="btn-quiet h-9 px-4">
                    <RotateCcw size={14} />
                    Reset to default
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 2. Manage Roles & Permissions */}
      {tab === 'roles' && roles && (
        <>
          <p className="text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">{roles.note}</p>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-4 py-3 font-semibold">Can do</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-4 py-3 font-semibold text-center capitalize">
                      {r}
                      <span className="block text-xs font-normal text-ink-faint">
                        {roles.counts[r] ?? 0}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.permissions.map((p) => (
                  <tr key={p.area} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{p.area}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="px-4 py-2.5 text-center">
                        {p[r]
                          ? <Check size={15} className="inline text-mood-5" />
                          : <span className="text-line-strong">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-ink-soft">
            To make someone an administrator, find them under Users and use the role action
            there. Psychologist and LGU accounts cannot change role, because they carry
            linked records that would be left orphaned.
          </p>
        </>
      )}

      {/* 3. Backup & Maintenance */}
      {tab === 'maintenance' && maintenance && (
        <>
          {maintenance.issues.length > 0 ? (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 font-bold">
                <AlertTriangle size={17} className="text-mood-2" />
                Needs attention
              </h2>
              <ul className="mt-4 space-y-2.5">
                {maintenance.issues.map((i) => (
                  <li key={i.issue} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm">
                      <strong className="tabular-nums">{i.n}</strong> {i.issue}
                    </span>
                    {TASK_FOR[i.issue] && (
                      <button
                        onClick={() => runTask(TASK_FOR[i.issue])}
                        disabled={busy === TASK_FOR[i.issue]}
                        className="btn-quiet h-9 px-4 text-xs"
                      >
                        <Play size={13} />
                        {busy === TASK_FOR[i.issue] ? 'Running…' : 'Fix'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="card p-5 text-sm text-ink-soft">Nothing needs attention.</p>
          )}

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-bold">
              <Database size={17} className="text-tide-500" />
              Data
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Database size {maintenance.database_size}.
            </p>
            <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {maintenance.counts.map((c) => (
                <li key={c.item} className="flex justify-between text-sm">
                  <span className="text-ink-soft capitalize">{c.item}</span>
                  <span className="font-semibold tabular-nums">{c.n}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">Backups</h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {maintenance.backups.note}
            </p>
          </section>
        </>
      )}

      {/* Audit log */}
      {tab === 'audit' && audit && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setAuditFilter('')}
              className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
                auditFilter === '' ? 'border-tide-500 bg-tide-50' : 'border-line'
              }`}
            >
              All
            </button>
            {audit.action_groups.map((g) => (
              <button
                key={g.prefix}
                onClick={() => setAuditFilter(g.prefix)}
                className={`h-8 px-3.5 rounded-pill text-sm font-medium border ${
                  auditFilter === g.prefix ? 'border-tide-500 bg-tide-50' : 'border-line'
                }`}
              >
                {g.prefix}
                <span className="ml-1.5 text-ink-faint">{g.n}</span>
              </button>
            ))}
          </div>

          <ul className="card divide-y divide-line">
            {audit.entries.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-ink-soft">
                Nothing recorded yet.
              </li>
            ) : audit.entries.map((e) => (
              <li key={e.log_id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="text-xs font-semibold bg-paper-sunk rounded px-1.5 py-0.5">
                    {e.action}
                  </code>
                  <span className="text-sm">{e.actor_name ?? 'system'}</span>
                  {e.actor_role && (
                    <span className="text-xs text-ink-faint">{e.actor_role}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-faint tabular-nums">
                    {format(parseISO(e.created_at), 'd MMM, h:mm a')}
                  </span>
                </div>
                {e.meta && Object.keys(e.meta).length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft font-mono break-all">
                    {JSON.stringify(e.meta)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
