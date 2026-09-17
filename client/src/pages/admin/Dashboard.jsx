import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserCheck, Flag, ShieldAlert, CreditCard, CalendarClock, Activity,
  AlertTriangle, Check,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Figure 46: Admin Dashboard.
 *   1. View Platform Statistics  2. View System Health
 *   3. View Pending Tasks
 *
 * Pending tasks come first. A dashboard that opens with a large resident
 * count and buries the fact that three crisis alerts have been sitting
 * open for a week has its priorities backwards, however good the number
 * looks.
 */

/** Each task links to where it is actually dealt with. */
const TASKS = [
  {
    key: 'licenses_to_review',
    icon: UserCheck,
    to: '/admin/verification',
    label: (n) => `${n} psychologist license${n === 1 ? '' : 's'} to review`,
    why: 'They cannot accept sessions until verified.',
    urgent: false,
  },
  {
    key: 'stale_alerts',
    icon: ShieldAlert,
    to: '/admin/ai-crisis',
    label: (n) => `${n} crisis alert${n === 1 ? '' : 's'} open over a week`,
    why: 'Nobody has picked these up. This is the one that matters most.',
    urgent: true,
  },
  {
    key: 'content_to_moderate',
    icon: Flag,
    to: '/admin/moderation',
    label: (n) => `${n} reported post${n === 1 ? '' : 's'} awaiting review`,
    why: 'Reported content stays visible until someone decides.',
    urgent: false,
  },
  {
    key: 'subscriptions_awaiting_payment',
    icon: CreditCard,
    to: '/admin/subscriptions',
    label: (n) => `${n} subscription${n === 1 ? '' : 's'} awaiting payment`,
    why: 'Care Credits cannot be allocated until these are marked paid.',
    urgent: false,
  },
  {
    key: 'subscriptions_expiring',
    icon: CalendarClock,
    to: '/admin/subscriptions',
    label: (n) => `${n} subscription${n === 1 ? '' : 's'} expiring within 30 days`,
    why: 'An expired subscription stops new credit allocation.',
    urgent: false,
  },
];

const HEALTH = [
  {
    key: 'journals_stuck',
    label: (n) => `${n} voice journal${n === 1 ? '' : 's'} stuck mid-pipeline`,
    fix: 'System settings, maintenance',
    to: '/admin/settings',
  },
  {
    key: 'journals_failed',
    label: (n) => `${n} journal${n === 1 ? '' : 's'} failed to process this week`,
    fix: 'Usually a transcription or connection problem',
    to: null,
  },
  {
    key: 'psychologists_without_hours',
    label: (n) => `${n} verified psychologist${n === 1 ? '' : 's'} with no working hours`,
    fix: 'Residents cannot book them at all',
    to: null,
  },
  {
    key: 'barangays_unfunded',
    label: (n) => `${n} barangay${n === 1 ? '' : 's'} with residents but no subscription`,
    fix: 'Their residents cannot be given Care Credits',
    to: '/admin/subscriptions',
  },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/analytics/dashboard').then(setData).catch((e) => setError(e.message));
  }, []);

  const tasks = TASKS.filter((t) => (data?.pending?.[t.key] ?? 0) > 0);
  const issues = HEALTH.filter((h) => (data?.health?.[h.key] ?? 0) > 0);
  const s = data?.stats;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{user?.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">Platform administration</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 3. View Pending Tasks — first, deliberately */}
      <section>
        <h2 className="font-bold">Needs you</h2>
        {tasks.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <Check size={15} className="text-mood-5" />
            Nothing waiting.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {tasks
              .sort((a, b) => Number(b.urgent) - Number(a.urgent))
              .map((t) => {
                const n = data.pending[t.key];
                const Icon = t.icon;
                return (
                  <li key={t.key}>
                    <Link
                      to={t.to}
                      className={`card p-4 flex items-start gap-3 hover:border-line-strong ${
                        t.urgent ? 'border-mood-1' : ''
                      }`}
                    >
                      <Icon size={18}
                            className={`shrink-0 mt-0.5 ${t.urgent ? 'text-mood-1' : 'text-tide-500'}`} />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{t.label(n)}</p>
                        <p className="mt-0.5 text-xs text-ink-soft">{t.why}</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* 1. View Platform Statistics */}
      {s && (
        <section>
          <h2 className="font-bold">Platform</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Residents', s.residents, `${s.joined_this_week} joined this week`],
              ['Psychologists', s.psychologists, 'verified'],
              ['Barangays subscribed', s.subscriptions, `of ${s.barangays}`],
              ['Sessions completed', s.sessions_completed,
                `${s.sessions_upcoming} upcoming`],
            ].map(([label, value, sub]) => (
              <div key={label} className="card p-5">
                <p className="text-sm text-ink-soft">{label}</p>
                <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">
                  {value}
                </p>
                <p className="mt-1 text-xs text-ink-faint">{sub}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            {s.booked_this_week} session{s.booked_this_week === 1 ? '' : 's'} booked in the
            last seven days.{' '}
            <Link to="/admin/analytics" className="font-semibold text-tide-700 underline">
              Full analytics
            </Link>
          </p>
        </section>
      )}

      {/* 2. View System Health */}
      <section>
        <h2 className="flex items-center gap-2 font-bold">
          <Activity size={17} className="text-tide-500" />
          System health
        </h2>
        {issues.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <Check size={15} className="text-mood-5" />
            Nothing to report. No stuck journals, every verified psychologist has working
            hours, and every barangay with residents has a subscription.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {issues.map((h) => {
              const n = data.health[h.key];
              const body = (
                <div className="card p-4 flex items-start gap-3">
                  <AlertTriangle size={17} className="shrink-0 mt-0.5 text-mood-2" />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{h.label(n)}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">{h.fix}</p>
                  </div>
                </div>
              );
              return (
                <li key={h.key}>
                  {h.to ? <Link to={h.to} className="block">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
