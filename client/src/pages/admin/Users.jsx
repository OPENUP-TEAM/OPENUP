import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Search, Ban, CheckCircle2, Trash2, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';

// Module: User Management.
const ROLE_LABEL = {
  resident: 'Resident',
  psychologist: 'Psychologist',
  lgu: 'LGU',
  admin: 'Admin',
};

const STATUS = {
  active:    { label: 'Active',    tone: 'text-mood-5 bg-mood-5/12' },
  pending:   { label: 'Pending',   tone: 'text-mood-3 bg-mood-3/12' },
  rejected:  { label: 'Rejected',  tone: 'text-mood-2 bg-mood-2/12' },
  suspended: { label: 'Suspended', tone: 'text-mood-1 bg-mood-1/12' },
};

export default function Users() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState(null); // { user, mode: 'suspend'|'activate'|'delete' }
  const [reason, setReason] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    api(`/users?${params}`).then(setData).catch((err) => setError(err.message));
  };

  useEffect(() => { load(); }, [q, role, status]);

  const submit = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (panel.mode === 'delete') {
        await api(`/users/${panel.user.user_id}`, {
          method: 'DELETE',
          body: { confirm_email: confirmEmail.trim() },
        });
        setNotice(`${panel.user.email} deleted.`);
      } else {
        await api(`/users/${panel.user.user_id}/status`, {
          method: 'PATCH',
          body: {
            status: panel.mode === 'suspend' ? 'suspended' : 'active',
            reason: reason.trim(),
          },
        });
        setNotice(
          panel.mode === 'suspend'
            ? `${panel.user.name} suspended.`
            : `${panel.user.name} reactivated.`
        );
      }
      setPanel(null);
      setReason('');
      setConfirmEmail('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    panel?.mode === 'delete'
      ? confirmEmail.trim() === panel.user.email
      : reason.trim().length >= 5;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Suspending an account takes effect immediately, not when their session expires.
        </p>
      </div>

      {data?.counts && (
        <section className="grid gap-4 sm:grid-cols-4">
          {['resident', 'psychologist', 'lgu', 'admin'].map((r) => (
            <button
              key={r}
              onClick={() => setRole(role === r ? '' : r)}
              className={`card p-5 text-left ${role === r ? 'border-tide-500' : ''}`}
            >
              <p className="text-sm text-ink-soft">{ROLE_LABEL[r]}s</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                {data.counts[r] ?? 0}
              </p>
              {data.counts[`${r}_suspended`] > 0 && (
                <p className="mt-1 text-xs text-mood-1">
                  {data.counts[`${r}_suspended`]} suspended
                </p>
              )}
            </button>
          ))}
        </section>
      )}

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            className="field pl-9" aria-label="Search users"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
                className="field w-auto" aria-label="Filter by status">
          <option value="">Any status</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Barangay</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                  No users match that.
                </td>
              </tr>
            ) : (
              data.users.map((u) => {
                const st = STATUS[u.status] ?? STATUS.active;
                return (
                  <tr key={u.user_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{u.name}</span>
                      <span className="block text-xs text-ink-faint">{u.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {ROLE_LABEL[u.role]}
                        {u.is_verified && (
                          <ShieldCheck size={13} className="text-mood-5" aria-label="Verified" />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{u.barangay_name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${st.tone}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-soft tabular-nums">
                      {format(parseISO(u.created_at), 'd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {u.status === 'suspended' ? (
                          <button
                            onClick={() => { setPanel({ user: u, mode: 'activate' }); setReason(''); }}
                            className="p-2 rounded-[8px] hover:bg-paper-sunk"
                            aria-label="Reactivate"
                            title="Reactivate"
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        ) : (
                          <button
                            onClick={() => { setPanel({ user: u, mode: 'suspend' }); setReason(''); }}
                            className="p-2 rounded-[8px] hover:bg-paper-sunk"
                            aria-label="Suspend"
                            title="Suspend"
                          >
                            <Ban size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => { setPanel({ user: u, mode: 'delete' }); setConfirmEmail(''); }}
                          className="p-2 rounded-[8px] hover:bg-paper-sunk text-ink-faint"
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 px-5">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-lg font-bold">
              {panel.mode === 'suspend' ? 'Suspend this account'
                : panel.mode === 'activate' ? 'Reactivate this account'
                : 'Delete this account'}
            </h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              {panel.user.name} · {panel.user.email}
            </p>

            {panel.mode === 'delete' ? (
              <>
                <p className="mt-4 text-sm leading-relaxed bg-mood-1/10 rounded-[10px] px-3.5 py-3">
                  This removes their mood entries, journals, bookings, and messages
                  permanently. There is no undo. Suspending is usually what you want
                  instead.
                </p>
                <label className="label mt-5" htmlFor="confirm">
                  Type their email to confirm
                </label>
                <input
                  id="confirm" className="field" value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  placeholder={panel.user.email} autoComplete="off"
                />
              </>
            ) : (
              <>
                <label className="label mt-5" htmlFor="reason">Reason</label>
                <textarea
                  id="reason" rows={3} value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    panel.mode === 'suspend'
                      ? 'Repeated abusive messages to residents in chat.'
                      : 'Issue resolved after review.'
                  }
                  className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm placeholder:text-ink-faint focus:border-tide-500"
                />
                <p className="mt-1.5 text-xs text-ink-faint">
                  Sent to the user and recorded in the audit log.
                </p>
              </>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={submit}
                disabled={!canSubmit || busy}
                className={`flex-1 ${panel.mode === 'delete' ? 'btn-primary bg-mood-1 hover:bg-mood-1/90' : 'btn-primary'}`}
              >
                {busy ? 'Working…'
                  : panel.mode === 'suspend' ? 'Suspend'
                  : panel.mode === 'activate' ? 'Reactivate'
                  : 'Delete permanently'}
              </button>
              <button onClick={() => setPanel(null)} className="btn-quiet px-5">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
