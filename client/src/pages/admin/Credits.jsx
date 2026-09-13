import { useEffect, useState } from 'react';
import { Coins, Plus, Undo2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Module: Care Credits Segregation.
 *
 * Credits are allocated to a barangay, not to a person. A platform
 * administrator has no basis for deciding which household in Inayawan
 * needs counseling; the barangay does. This screen ends at the barangay
 * boundary on purpose.
 */

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

export default function Credits() {
  const [barangays, setBarangays] = useState([]);
  const [totals, setTotals] = useState(null);
  const [allBarangays, setAllBarangays] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState({
    barangay_id: '', count: 10, amount: 800, expires_at: '', note: '',
  });

  const load = () => {
    api('/credits/distribution')
      .then(({ barangays, totals }) => { setBarangays(barangays); setTotals(totals); })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
    api('/barangays').then(({ barangays }) => setAllBarangays(barangays)).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const allocate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api('/credits/allocate', {
        method: 'POST',
        body: {
          barangay_id: form.barangay_id,
          count: form.count,
          amount: form.amount,
          expires_at: form.expires_at || undefined,
          note: form.note || undefined,
        },
      });
      setNotice(`${r.created} credits allocated to ${r.barangay}.`);
      setForm({ ...form, note: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (barangay_id, name, pool) => {
    const count = Number(prompt(`Withdraw how many unassigned credits from ${name}? (${pool} in pool)`));
    if (!count || count < 1) return;
    setError('');
    setNotice('');
    try {
      const r = await api('/credits/withdraw', {
        method: 'POST',
        body: { barangay_id, count },
      });
      setNotice(`${r.withdrawn} credits withdrawn from ${name}.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Care Credits</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Allocate credits to a barangay. The barangay decides which of its residents
          receive them.
        </p>
      </div>

      {totals && (
        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Unassigned in pools', value: peso(totals.pool_value) },
            { label: 'Used on sessions', value: peso(totals.consumed_value) },
            { label: 'Total allocated', value: peso(totals.total_value) },
          ].map(({ label, value }) => (
            <div key={label} className="card p-5">
              <p className="text-sm text-ink-soft">{label}</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
            </div>
          ))}
        </section>
      )}

      {/* 1. Allocate Care Credits */}
      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <Coins size={17} className="text-tide-500" />
          Allocate a batch
        </h2>

        <form onSubmit={allocate} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="barangay">Barangay</label>
            <select
              id="barangay" required className="field"
              value={form.barangay_id} onChange={set('barangay_id')}
            >
              <option value="">Choose a barangay</option>
              {allBarangays.map((b) => (
                <option key={b.barangay_id} value={b.barangay_id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="count">How many credits</label>
            <input
              id="count" type="number" min={1} max={500} required className="field"
              value={form.count} onChange={set('count')}
            />
          </div>

          <div>
            <label className="label" htmlFor="amount">Value of each</label>
            <input
              id="amount" type="number" min={1} step="0.01" required className="field"
              value={form.amount} onChange={set('amount')}
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              One credit covers one session at this rate.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="expires">Expires (optional)</label>
            <input
              id="expires" type="date" className="field"
              value={form.expires_at} onChange={set('expires_at')}
            />
          </div>

          <div>
            <label className="label" htmlFor="note">Reference (optional)</label>
            <input
              id="note" className="field" placeholder="Q1 2026 allocation"
              value={form.note} onChange={set('note')}
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-between gap-4">
            <p className="text-sm text-ink-soft">
              Total value{' '}
              <strong className="tabular-nums">
                {peso(Number(form.count || 0) * Number(form.amount || 0))}
              </strong>
            </p>
            <button type="submit" disabled={busy} className="btn-primary">
              <Plus size={16} />
              {busy ? 'Allocating…' : 'Allocate'}
            </button>
          </div>
        </form>
      </section>

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="flex gap-2 text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {error}
        </p>
      )}

      {/* 3. Track Distribution */}
      <section>
        <h2 className="font-bold">Distribution by barangay</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Utilization is the share of assigned credits residents have actually used.
          A low figure usually means credits reached people who are not booking.
        </p>

        <div className="mt-4 card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-semibold">Barangay</th>
                <th className="px-4 py-3 font-semibold text-right">Pool</th>
                <th className="px-4 py-3 font-semibold text-right">Assigned</th>
                <th className="px-4 py-3 font-semibold text-right">Used</th>
                <th className="px-4 py-3 font-semibold text-right">Utilization</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {barangays.filter((b) => b.total_count > 0).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                    No credits allocated yet.
                  </td>
                </tr>
              ) : (
                barangays
                  .filter((b) => b.total_count > 0)
                  .map((b) => (
                    <tr key={b.barangay_id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium">{b.barangay_name}</span>
                        <span className="block text-xs text-ink-faint">
                          {b.resident_count} resident{b.resident_count === 1 ? '' : 's'}
                          {b.plan ? ` · ${b.plan}` : ' · no subscription'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.pool_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.assigned_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.consumed_count}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center gap-2">
                          <span className="w-16 h-1.5 rounded-pill bg-paper-sunk overflow-hidden">
                            <span
                              className="block h-full rounded-pill bg-tide-500"
                              style={{ width: `${b.utilization_pct}%` }}
                            />
                          </span>
                          <span className="tabular-nums w-10 text-right">
                            {b.utilization_pct}%
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {b.pool_count > 0 && (
                          <button
                            onClick={() => withdraw(b.barangay_id, b.barangay_name, b.pool_count)}
                            className="text-xs font-semibold text-ink-soft hover:text-ink inline-flex items-center gap-1"
                          >
                            <Undo2 size={13} />
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
