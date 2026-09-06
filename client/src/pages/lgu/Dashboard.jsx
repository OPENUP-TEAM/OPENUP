import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

// Figure 40: LGU Dashboard — "Your Barangay" plus a citywide comparison.
export default function LguDashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [heatmap, setHeatmap] = useState([]);

  useEffect(() => {
    api('/lgu/dashboard').then(setSummary).catch(() => {});
    api('/lgu/heatmap').then(({ barangays }) => setHeatmap(barangays)).catch(() => {});
  }, []);

  const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Community figures only. No resident name, message, or session note appears here.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Registered residents', value: summary?.registered_residents ?? '—' },
          { label: 'Open high-risk alerts', value: summary?.high_risk_open ?? '—' },
          { label: 'Care Credits used', value: peso(summary?.budget?.credits_used) },
          { label: 'Wellness index', value: summary?.wellness?.wellness_index ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} className="card p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight">{value}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Citywide wellness index</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Lower scores suggest a barangay may need more support.
        </p>
        <ol className="mt-5 space-y-2.5">
          {heatmap.map((b) => {
            const mine = b.barangay_id === summary?.barangay_id;
            return (
              <li key={b.barangay_id} className="flex items-center gap-3">
                <span className={`w-36 shrink-0 text-sm ${mine ? 'font-bold' : 'text-ink-soft'}`}>
                  {b.barangay_name}
                </span>
                <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden">
                  <div
                    className="h-full rounded-pill bg-tide-500"
                    style={{ width: `${b.wellness_index}%` }}
                  />
                </div>
                <span className="w-10 text-right text-sm tabular-nums">{b.wellness_index}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
