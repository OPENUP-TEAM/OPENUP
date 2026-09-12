import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

// Figure 46: Admin Dashboard.
export default function AdminDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    api('/admin/verification/summary').then(setVerification).catch(() => {});
    // Admin passes the LGU role check, so this endpoint works for now.
    api('/lgu/heatmap')
      .then(({ barangays }) =>
        setStats({
          barangays: barangays.length,
          residents: barangays.reduce((a, b) => a + Number(b.resident_count || 0), 0),
          crises: barangays.reduce((a, b) => a + Number(b.crisis_count || 0), 0),
        })
      )
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">Platform administration</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Barangays', value: stats?.barangays ?? '—' },
          { label: 'Residents', value: stats?.residents ?? '—' },
          { label: 'Crisis alerts', value: stats?.crises ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} className="card p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight">{value}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Pending tasks</h2>
        {verification?.pending > 0 ? (
          <div className="mt-3 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">
                {verification.pending} psychologist
                {verification.pending === 1 ? '' : 's'} awaiting verification
              </p>
              {verification.awaiting_document > 0 && (
                <p className="text-sm text-ink-soft">
                  {verification.awaiting_document} still needs to upload a license document.
                </p>
              )}
            </div>
            <Link to="/admin/verification" className="btn-primary h-9 px-4">Review</Link>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">
            Nothing waiting. {verification?.verified ?? 0} psychologist
            {verification?.verified === 1 ? '' : 's'} verified so far.
          </p>
        )}
      </section>
    </div>
  );
}
