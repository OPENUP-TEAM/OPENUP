import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  ShieldCheck, Eye, EyeOff, Check, X, AlertTriangle, FileSignature, Users,
} from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Figure 44: Data Governance & Consent.
 *
 * Everything here is a count. An LGU learning that a named resident
 * withdrew consent to barangay analytics would defeat the withdrawal, so
 * no screen in this module can name one.
 */
const TABS = [
  { key: 'consent',    label: 'Consent',     icon: Users },
  { key: 'access',     label: 'Data access', icon: Eye },
  { key: 'compliance', label: 'Compliance',  icon: ShieldCheck },
];

const STATUS = {
  pass:           { label: 'Pass',            icon: Check,         tone: 'text-mood-5' },
  fail:           { label: 'Fail',            icon: X,             tone: 'text-mood-1' },
  attention:      { label: 'Needs attention', icon: AlertTriangle, tone: 'text-mood-2' },
  attestation:    { label: 'Needs sign-off',  icon: FileSignature, tone: 'text-ink-faint' },
  not_applicable: { label: 'Not applicable',  icon: X,             tone: 'text-ink-faint' },
};

export default function Governance() {
  const [tab, setTab] = useState('consent');
  const [consent, setConsent] = useState(null);
  const [access, setAccess] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (tab === 'consent') api('/governance/consent').then(setConsent).catch((e) => setError(e.message));
    if (tab === 'access') api('/governance/data-access').then(setAccess).catch((e) => setError(e.message));
    if (tab === 'compliance') api('/governance/compliance').then(setCompliance).catch((e) => setError(e.message));
  }, [tab]);

  const maxMonth = Math.max(
    ...(consent?.monthly ?? []).map((m) => m.grants + m.withdrawals), 1
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Data governance</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What your barangay may see, what residents have agreed to, and where you stand
          against the Data Privacy Act.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
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

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {/* 1. View Consent Records */}
      {tab === 'consent' && consent && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Counted in statistics', value: consent.analytics.counted },
              { label: 'Opted out', value: consent.analytics.excluded },
              { label: 'Residents total', value: consent.analytics.total },
            ].map(({ label, value }) => (
              <div key={label} className="card p-5">
                <p className="text-sm text-ink-soft">{label}</p>
                <p className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums">
                  {value}
                </p>
              </div>
            ))}
          </section>

          {consent.analytics.excluded > 0 && (
            <p className="flex gap-2 text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">
              <EyeOff size={15} className="shrink-0 mt-0.5 text-ink-faint" />
              {consent.analytics.excluded} resident
              {consent.analytics.excluded === 1 ? ' has' : 's have'} opted out of barangay
              statistics. They are excluded from every figure on your dashboard and
              heatmap. Who they are is not shown, and cannot be.
            </p>
          )}

          <section className="card p-5">
            <h2 className="font-bold">By consent type</h2>
            <ul className="mt-4 space-y-3">
              {consent.by_type.map((t) => {
                const total = t.granted + t.withdrawn;
                return (
                  <li key={t.consent_type}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">{t.label}</span>
                      <span className="text-sm tabular-nums text-ink-faint">
                        {t.granted} of {total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-pill bg-paper-sunk overflow-hidden">
                      <div className="h-full rounded-pill bg-tide-500"
                           style={{ width: `${total ? (t.granted / total) * 100 : 0}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {consent.monthly.length > 0 && (
            <section className="card p-5">
              <h2 className="font-bold">Changes by month</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Rising withdrawals are worth understanding, even without knowing who.
              </p>
              <ul className="mt-4 space-y-2.5">
                {consent.monthly.map((m) => (
                  <li key={m.month} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm text-ink-soft">
                      {format(parseISO(m.month), 'MMM yyyy')}
                    </span>
                    <div className="flex-1 h-2.5 rounded-pill bg-paper-sunk overflow-hidden flex">
                      <div className="h-full bg-tide-500"
                           style={{ width: `${(m.grants / maxMonth) * 100}%` }} />
                      <div className="h-full bg-mood-2"
                           style={{ width: `${(m.withdrawals / maxMonth) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-xs tabular-nums text-ink-faint">
                      {m.grants} on, {m.withdrawals} off
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* 2. Manage Data Access */}
      {tab === 'access' && access && (
        <>
          <p className="text-sm bg-paper-sunk rounded-[10px] px-3.5 py-3">{access.note}</p>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-bold">
              <Eye size={17} className="text-mood-5" />
              Your barangay can see
            </h2>
            <ul className="mt-3 space-y-2">
              {access.visible.map((v) => (
                <li key={v.item} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>{v.item}</span>
                  <code className="text-xs text-ink-faint">{v.source}</code>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-bold">
              <EyeOff size={17} className="text-mood-1" />
              Your barangay cannot see
            </h2>
            <ul className="mt-3 space-y-3">
              {access.not_visible.map((v) => (
                <li key={v.item}>
                  <p className="text-sm font-medium">{v.item}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{v.why}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* 3. View Compliance Status */}
      {tab === 'compliance' && compliance && (
        <>
          <p className="text-sm text-ink-soft">
            Measured against {compliance.reference}.
          </p>

          <ul className="card divide-y divide-line">
            {compliance.checks.map((c) => {
              const st = STATUS[c.status] ?? STATUS.attestation;
              const Icon = st.icon;
              return (
                <li key={c.item} className="px-5 py-4 flex gap-3">
                  <Icon size={17} className={`${st.tone} shrink-0 mt-0.5`} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{c.item}</p>
                    <p className="mt-0.5 text-sm text-ink-soft leading-relaxed">{c.detail}</p>
                  </div>
                  <span className={`ml-auto shrink-0 text-xs font-semibold ${st.tone}`}>
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-ink-faint leading-relaxed">
            Items marked as needing sign-off cannot be checked by software. Appointing a
            Data Protection Officer, agreeing a retention period, and confirming the
            privacy notice meets National Privacy Commission requirements are decisions
            for the barangay and its legal adviser.
          </p>
        </>
      )}
    </div>
  );
}
