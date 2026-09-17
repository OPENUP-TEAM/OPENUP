import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Search, ArrowLeft, Languages, ShieldCheck, Clock, CalendarX,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 45: Psychologist Directory.
 *
 * An LGU pays for sessions, so it may reasonably ask who provides them and
 * how much they are being used. It may not ask who saw whom. Every figure
 * here is a count; no resident appears anywhere.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH')}`;

export default function Directory() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [language, setLanguage] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [open, setOpen] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (language) params.set('language', language);
    if (specialization) params.set('specialization', specialization);
    api(`/lgu/psychologists?${params}`).then(setData).catch((e) => setError(e.message));
  }, [q, language, specialization]);

  const openProfile = async (id) => {
    setOpen(id);
    setProfile(null);
    try {
      setProfile(await api(`/lgu/psychologists/${id}`));
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e.message);
    }
  };

  if (open && profile) {
    const p = profile.psychologist;
    const u = profile.usage_in_barangay;

    return (
      <div className="space-y-6 max-w-2xl">
        <button
          onClick={() => { setOpen(null); setProfile(null); }}
          className="flex items-center gap-1.5 text-sm font-semibold text-tide-700"
        >
          <ArrowLeft size={15} />
          Directory
        </button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-tide-700 font-medium">
            <ShieldCheck size={14} />
            Verified {p.verified_at && format(parseISO(p.verified_at), 'd MMM yyyy')}
            {p.verified_by_name && ` by ${p.verified_by_name}`}
          </p>
        </div>

        <section className="card p-5">
          <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">PRC license</dt>
              <dd className="font-semibold tabular-nums">{p.license_no}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Rate</dt>
              <dd className="font-semibold tabular-nums">{peso(p.rate_per_hour)} per hour</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Specialization</dt>
              <dd>{p.specialization || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Languages</dt>
              <dd>{p.languages || '—'}</dd>
            </div>
          </dl>
          {p.bio && (
            <p className="mt-4 pt-4 border-t border-line text-sm leading-relaxed">{p.bio}</p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <Clock size={16} className="text-tide-500" />
            Working hours
          </h2>
          {profile.availability.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No hours set, so residents cannot currently book with them.
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {profile.availability.map((a, i) => (
                <li key={i} className="flex gap-4 text-sm">
                  <span className="w-12 font-medium">{DAYS[a.day_of_week]}</span>
                  <span className="tabular-nums text-ink-soft">
                    {a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Use in your barangay</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Counts only. No resident is named here, and none can be.
          </p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-4">
            {[
              { label: 'Sessions completed', value: u.completed },
              { label: 'Residents seen', value: u.residents_seen },
              { label: 'Missed', value: u.missed },
              { label: 'Spent', value: peso(u.spent_here) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-ink-faint">{label}</p>
                <p className="mt-1 text-xl font-extrabold tracking-tight tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Psychologist directory</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Everyone verified on the platform, and how much each has been used by your
          residents.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name" className="field pl-9"
            aria-label="Search psychologists"
          />
        </div>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}
                className="field w-auto" aria-label="Filter by language">
          <option value="">Any language</option>
          {(data?.languages ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={specialization} onChange={(e) => setSpecialization(e.target.value)}
                className="field w-auto" aria-label="Filter by specialization">
          <option value="">Any specialization</option>
          {(data?.specializations ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {(data?.psychologists ?? []).length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-soft">Nobody matches those filters.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.psychologists.map((p) => (
            <li key={p.psychologist_id}>
              <button
                onClick={() => openProfile(p.psychologist_id)}
                className="card p-5 w-full text-left hover:border-line-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-bold">{p.name}</h2>
                    {p.specialization && (
                      <p className="text-sm text-tide-700 font-medium">{p.specialization}</p>
                    )}
                    {p.languages && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-faint">
                        <Languages size={13} />
                        {p.languages}
                      </p>
                    )}
                    {!p.takes_bookings && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-mood-2">
                        <CalendarX size={13} />
                        No working hours set, so residents cannot book them
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums">{peso(p.rate_per_hour)}</p>
                    <p className="text-xs text-ink-faint">per hour</p>
                    <p className="mt-2 text-xs">
                      <span className="font-semibold tabular-nums">{p.sessions_here}</span>
                      <span className="text-ink-faint"> sessions here</span>
                    </p>
                    {p.sessions_total > p.sessions_here && (
                      <p className="text-xs text-ink-faint tabular-nums">
                        {p.sessions_total} citywide
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
