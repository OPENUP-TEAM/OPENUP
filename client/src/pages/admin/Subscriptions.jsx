import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, CheckCircle2, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';

// Module: Subscription Monitoring.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

const STATUS = {
  active:    { label: 'Active',          tone: 'text-mood-5 bg-mood-5/12' },
  pending:   { label: 'Awaiting payment', tone: 'text-mood-3 bg-mood-3/12' },
  expired:   { label: 'Expired',         tone: 'text-mood-2 bg-mood-2/12' },
  cancelled: { label: 'Cancelled',       tone: 'text-ink-faint bg-paper-sunk' },
};

export default function Subscriptions() {
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ barangay_id: '', plan: 'standard', months: 12 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    const qs = filter ? `?status=${filter}` : '';
    api(`/subscriptions${qs}`).then(setData).catch((err) => setError(err.message));
  };

  useEffect(load, [filter]);
  useEffect(() => {
    api('/subscriptions/plans').then(({ plans }) => setPlans(plans)).catch(() => {});
    api('/barangays').then(({ barangays }) => setBarangays(barangays)).catch(() => {});
  }, []);

  const act = async (id, path, body) => {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      const r = await api(`/subscriptions/${id}/${path}`, { method: 'PATCH', body });
      setNotice(r.note || 'Done.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await api('/subscriptions', { method: 'POST', body: form });
      setCreating(false);
      setForm({ barangay_id: '', plan: 'standard', months: 12 });
      setNotice('Subscription created, awaiting payment.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
          <p className="mt-1 text-sm text-ink-soft">
            A barangay must have an active subscription before Care Credits can be
            allocated to it.
          </p>
        </div>
        <button onClick={() => setCreating((c) => !c)} className="btn-primary h-10 px-4">
          <Plus size={16} />
          New subscription
        </button>
      </div>

      {s && (
        <section className="grid gap-4 sm:grid-cols-4">
          {[
            { label: 'Active', value: s.active },
            { label: 'Awaiting payment', value: s.pending },
            { label: 'Expiring in 30 days', value: s.expiring_soon },
            { label: 'Annual revenue', value: peso(s.revenue) },
          ].map(({ label, value }) => (
            <div key={label} className="card p-5">
              <p className="text-sm text-ink-soft">{label}</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
            </div>
          ))}
        </section>
      )}

      {creating && (
        <form onSubmit={create} className="card p-5 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="b">Barangay</label>
            <select id="b" required className="field" value={form.barangay_id}
                    onChange={(e) => setForm({ ...form, barangay_id: e.target.value })}>
              <option value="">Choose</option>
              {barangays.map((b) => (
                <option key={b.barangay_id} value={b.barangay_id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p">Plan</label>
            <select id="p" className="field" value={form.plan}
                    onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label} — {peso(p.amount)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="m">Months</label>
            <input id="m" type="number" min={1} max={36} className="field" value={form.months}
                   onChange={(e) => setForm({ ...form, months: e.target.value })} />
          </div>
          <div className="sm:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" onClick={() => setCreating(false)} className="btn-quiet">
              Cancel
            </button>
          </div>
        </form>
      )}

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {[['', 'All'], ['active', 'Active'], ['pending', 'Awaiting payment'],
          ['expired', 'Expired']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-9 px-4 rounded-pill text-sm font-semibold ${
              filter === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="space-y-3">
        {(data?.subscriptions ?? []).map((sub) => {
          const st = STATUS[sub.status] ?? STATUS.pending;
          const expiring = sub.days_remaining !== null && sub.days_remaining <= 30;
          return (
            <li key={sub.subscription_id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">{sub.barangay_name}</h3>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${st.tone}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ink-soft capitalize">
                    {sub.plan} · {peso(sub.amount)}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {format(parseISO(sub.start_date), 'd MMM yyyy')}
                    {sub.end_date && ` to ${format(parseISO(sub.end_date), 'd MMM yyyy')}`}
                    {' · '}{sub.residents} residents
                    {' · '}{sub.credits_used} of {sub.credits_allocated} credits used
                  </p>
                  {expiring && sub.status === 'active' && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-mood-2">
                      <AlertTriangle size={13} />
                      Expires in {sub.days_remaining} day{sub.days_remaining === 1 ? '' : 's'}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-2 shrink-0 min-w-[130px]">
                  {sub.status === 'pending' && (
                    <button
                      onClick={() => act(sub.subscription_id, 'activate')}
                      disabled={busyId === sub.subscription_id}
                      className="btn-primary h-9 px-4"
                    >
                      <CheckCircle2 size={15} />
                      Mark paid
                    </button>
                  )}
                  {['active', 'expired'].includes(sub.status) && (
                    <button
                      onClick={() => act(sub.subscription_id, 'renew', { months: 12 })}
                      disabled={busyId === sub.subscription_id}
                      className="btn-quiet h-9 px-4"
                    >
                      <RefreshCw size={14} />
                      Renew 12mo
                    </button>
                  )}
                  {['active', 'pending'].includes(sub.status) && (
                    <button
                      onClick={() => act(sub.subscription_id, 'cancel')}
                      disabled={busyId === sub.subscription_id}
                      className="btn-quiet h-9 px-4"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {data?.unsubscribed?.length > 0 && (
        <section>
          <h2 className="font-bold">Barangays without a subscription</h2>
          <p className="mt-1 text-sm text-ink-soft">
            These have registered residents but no way to fund sessions for them.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {data.unsubscribed.map((b) => (
              <li key={b.barangay_id}
                  className="text-sm bg-paper-sunk rounded-pill px-3.5 py-1.5">
                {b.name}
                <span className="text-ink-faint"> · {b.residents}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
