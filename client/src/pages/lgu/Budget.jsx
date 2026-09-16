import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Search, UserPlus, Undo2, Wallet, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 43: Resource & Budget Management.
 *
 * The barangay decides who gets credits. This screen is the whole answer
 * to "what did our subscription buy", which is the question a barangay
 * captain has to answer at budget time.
 */

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

export default function Budget() {
  const [data, setData] = useState(null);
  const [residents, setResidents] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api('/credits/budget').then(setData).catch((err) => setError(err.message));
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
    api(`/credits/residents${params}`)
      .then(({ residents }) => setResidents(residents))
      .catch(() => {});
  };

  useEffect(() => { load(); }, [q]);

  const assign = async (resident_id, name) => {
    setBusyId(resident_id);
    setError('');
    setNotice('');
    try {
      const r = await api('/credits/assign', {
        method: 'POST',
        body: { resident_id, count: 1 },
      });
      setNotice(`1 credit given to ${r.resident}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const reclaim = async (resident_id) => {
    setBusyId(resident_id);
    setError('');
    setNotice('');
    try {
      const r = await api('/credits/reclaim', {
        method: 'POST',
        body: { resident_id, count: 1 },
      });
      setNotice(`${r.reclaimed} credit returned to the pool.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const d = data?.distribution;
  const activeSub = data?.subscriptions?.find((s) => s.status === 'active');
  const maxSpend = Math.max(...(data?.spending ?? []).map((s) => Number(s.spent)), 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Resources and budget</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Credits your barangay holds, who has them, and what they have paid for.
        </p>
      </div>

      {/* 1. View Resource Allocation, 4. Monitor Credit Usage */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Unassigned pool', value: d?.pool_count ?? '—',
            sub: peso(d?.pool_value) },
          { label: 'Held by residents', value: d?.assigned_count ?? '—',
            sub: `${d?.reserved_count ?? 0} on booked sessions` },
          { label: 'Sessions paid for', value: d?.consumed_count ?? '—',
            sub: peso(d?.consumed_value) },
          { label: 'Utilization', value: d ? `${d.utilization_pct}%` : '—',
            sub: 'of assigned credits used' },
        ].map(({ label, value, sub }) => (
          <div key={label} className="card p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-ink-faint">{sub}</p>
          </div>
        ))}
      </section>

      {d?.pool_count === 0 && (
        <p className="flex gap-2 text-sm bg-mood-3/12 rounded-[10px] px-3.5 py-3">
          <Wallet size={15} className="shrink-0 mt-0.5 text-mood-3" />
          Your pool is empty. Contact the OpenUp administrator to request more credits
          for your barangay.
        </p>
      )}

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 5. View Subscription Costs */}
      {activeSub && (
        <section className="card p-5">
          <h2 className="font-bold">Subscription</h2>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Plan</dt>
              <dd className="font-semibold capitalize">{activeSub.plan}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Cost</dt>
              <dd className="font-semibold tabular-nums">{peso(activeSub.amount)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Started</dt>
              <dd>{format(parseISO(activeSub.start_date), 'd MMM yyyy')}</dd>
            </div>
            {activeSub.end_date && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-faint">Renews</dt>
                <dd>{format(parseISO(activeSub.end_date), 'd MMM yyyy')}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* 6. View Program Spending */}
      {data?.spending?.length > 0 && (
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <TrendingUp size={16} className="text-tide-500" />
            Spending by month
          </h2>
          <ul className="mt-4 space-y-2.5">
            {data.spending.map((s) => (
              <li key={s.month} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-sm text-ink-soft">
                  {format(parseISO(s.month), 'MMM yyyy')}
                </span>
                <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                  <div
                    className="h-full rounded-pill bg-tide-500"
                    style={{ width: `${(Number(s.spent) / maxSpend) * 100}%` }}
                  />
                </div>
                <span className="w-24 text-right text-sm tabular-nums">{peso(s.spent)}</span>
                <span className="w-16 text-right text-xs text-ink-faint">
                  {s.sessions} session{s.sessions === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. Assign / Adjust Resources, 3. Fund Care Credits */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-bold">Residents</h2>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name"
              className="field pl-9 h-10 w-56"
              aria-label="Search residents"
            />
          </div>
        </div>

        {residents.length === 0 ? (
          <div className="card p-8 text-center mt-4">
            <p className="text-sm text-ink-soft">
              No residents registered in your barangay yet.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {residents.map((r) => (
              <li key={r.user_id} className="card p-4 flex flex-wrap items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-xs text-ink-faint">
                    {r.available} available · {r.reserved} on bookings · {r.consumed} used
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {r.available > 0 && (
                    <button
                      onClick={() => reclaim(r.user_id)}
                      disabled={busyId === r.user_id}
                      className="btn-quiet h-9 px-3 text-xs"
                    >
                      <Undo2 size={13} />
                      Reclaim
                    </button>
                  )}
                  <button
                    onClick={() => assign(r.user_id, r.name)}
                    disabled={busyId === r.user_id || d?.pool_count === 0}
                    className="btn-primary h-9 px-3 text-xs"
                  >
                    <UserPlus size={13} />
                    Give credit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
