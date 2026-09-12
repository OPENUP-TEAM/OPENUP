import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { FileText, ExternalLink, Check, X, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api.js';

// Module: Psychologist Verification — Review Credentials / Approve / Reject.
const TABS = [
  { key: 'pending',  label: 'Awaiting review' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
];

export default function Verification() {
  const [tab, setTab] = useState('pending');
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api(`/admin/verification?status=${tab}`)
      .then(({ applications }) => setApps(applications))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const approve = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/admin/verification/${id}/approve`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/admin/verification/${id}/reject`, {
        method: 'PATCH',
        body: { reason: reason.trim() },
      });
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Psychologist verification</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Check each PRC license against the document before approving. An approved
          account can immediately accept residents for counseling.
        </p>
      </div>

      <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`h-9 px-4 rounded-pill text-sm font-semibold ${
              tab === key ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading applications…</p>
      ) : apps.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-soft">
            {tab === 'pending'
              ? 'No applications waiting. New sign-ups appear here automatically.'
              : `No ${tab} psychologists.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {apps.map((a) => (
            <li key={a.psychologist_id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-bold">{a.name}</h2>
                  <p className="text-sm text-ink-soft">{a.email}</p>
                  <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
                    <div className="flex gap-2">
                      <dt className="text-ink-faint">License</dt>
                      <dd className="font-semibold tabular-nums">{a.license_no}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-faint">Barangay</dt>
                      <dd>{a.barangay_name}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-faint">Specialization</dt>
                      <dd>{a.specialization || '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-faint">Languages</dt>
                      <dd>{a.languages || '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-ink-faint">Applied</dt>
                      <dd>{format(parseISO(a.created_at), 'd MMM yyyy')}</dd>
                    </div>
                    {a.verified_at && (
                      <div className="flex gap-2">
                        <dt className="text-ink-faint">Reviewed</dt>
                        <dd>
                          {format(parseISO(a.verified_at), 'd MMM yyyy')}
                          {a.reviewed_by_name ? ` by ${a.reviewed_by_name}` : ''}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {a.bio && <p className="mt-3 text-sm text-ink-soft leading-relaxed">{a.bio}</p>}
                </div>

                <div className="flex flex-col items-stretch gap-2 shrink-0">
                  {a.document_url ? (
                    <a
                      href={a.document_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-quiet h-9 px-4"
                    >
                      <FileText size={15} />
                      View license
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-2 h-9 px-3 rounded-pill bg-mood-2/15 text-xs font-semibold text-mood-2">
                      <ShieldAlert size={14} />
                      No document uploaded
                    </span>
                  )}

                  {tab === 'pending' && (
                    <>
                      <button
                        onClick={() => approve(a.psychologist_id)}
                        disabled={busyId === a.psychologist_id || !a.has_document}
                        className="btn-primary h-9 px-4"
                      >
                        <Check size={15} />
                        Approve
                      </button>
                      <button
                        onClick={() =>
                          setRejecting(rejecting === a.psychologist_id ? null : a.psychologist_id)
                        }
                        disabled={busyId === a.psychologist_id}
                        className="btn-quiet h-9 px-4"
                      >
                        <X size={15} />
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* The applicant sees this text, so it has to be usable. */}
              {rejecting === a.psychologist_id && (
                <div className="mt-4 pt-4 border-t border-line">
                  <label className="label" htmlFor={`reason-${a.psychologist_id}`}>
                    Why can this license not be verified?
                  </label>
                  <textarea
                    id={`reason-${a.psychologist_id}`}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="The uploaded document is unreadable. Please upload a clearer photo of your PRC ID."
                    className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm placeholder:text-ink-faint focus:border-tide-500"
                  />
                  <p className="mt-1.5 text-xs text-ink-faint">
                    This is sent to the applicant. Be specific enough that they can fix it.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => reject(a.psychologist_id)}
                      disabled={reason.trim().length < 10 || busyId === a.psychologist_id}
                      className="btn-primary h-9 px-4"
                    >
                      Send rejection
                    </button>
                    <button
                      onClick={() => { setRejecting(null); setReason(''); }}
                      className="btn-quiet h-9 px-4"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
