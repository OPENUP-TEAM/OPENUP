import { useEffect, useRef, useState } from 'react';
import { Upload, Clock, CheckCircle2, AlertCircle, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Where a psychologist lands before verification.
 *
 * A pending applicant can sign in but reach nothing else, so this screen
 * has to carry the whole story: what state they are in, what to do next,
 * and why they were rejected if they were.
 */
export default function PendingVerification() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    api('/me/psychologist/verification')
      .then(setStatus)
      .catch((err) => setError(err.message));

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      // Multipart, so this bypasses the JSON api() helper.
      const body = new FormData();
      body.append('document', file);
      const res = await fetch('/api/me/psychologist/verification/document', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Upload failed.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const signOut = () => { logout(); navigate('/'); };

  const STATES = {
    awaiting_document: {
      icon: Upload,
      tone: 'text-mood-2',
      title: 'Upload your PRC license',
      body: 'We need a photo or scan of your PRC identification card before an administrator can verify your account. Make sure your name and license number are readable.',
    },
    under_review: {
      icon: Clock,
      tone: 'text-tide-500',
      title: 'Your license is being reviewed',
      body: 'An administrator is checking your document against the PRC registry. This usually takes one to two working days, and you will be notified once it is done.',
    },
    verified: {
      icon: CheckCircle2,
      tone: 'text-mood-5',
      title: 'You are verified',
      body: 'Residents can now find you and request sessions.',
    },
    rejected: {
      icon: AlertCircle,
      tone: 'text-mood-1',
      title: 'Your license could not be verified',
      body: 'Read the reason below, then upload a corrected document. Your application stays open.',
    },
  };

  const state = STATES[status?.state] ?? STATES.awaiting_document;
  const Icon = state.icon;
  const canUpload = status?.state !== 'verified';

  return (
    <div className="min-h-screen px-5 py-12">
      <div className="max-w-xl mx-auto">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-extrabold tracking-tight">OpenUp</span>
          <button onClick={signOut} className="text-sm text-ink-soft inline-flex items-center gap-1.5">
            <LogOut size={14} />
            Sign out
          </button>
        </div>

        <div className="card p-6 mt-8">
          <Icon size={26} className={state.tone} />
          <h1 className="mt-4 text-xl font-bold tracking-tight">{state.title}</h1>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{state.body}</p>

          <dl className="mt-5 pt-5 border-t border-line grid gap-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-faint w-28">Name</dt>
              <dd className="font-medium">{user?.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint w-28">License number</dt>
              <dd className="font-medium tabular-nums">{status?.license_no ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-faint w-28">Document</dt>
              <dd className="font-medium">{status?.has_document ? 'Uploaded' : 'Not uploaded'}</dd>
            </div>
          </dl>

          {status?.rejection_reason && (
            <p className="mt-5 text-sm bg-mood-1/10 text-ink rounded-[10px] px-3.5 py-3 leading-relaxed">
              {status.rejection_reason.replace('Your license could not be verified: ', '')}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-5 text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
              {error}
            </p>
          )}

          {canUpload && (
            <div className="mt-6">
              <input
                ref={fileRef}
                id="license"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={submit}
                disabled={busy}
                className="sr-only"
              />
              <label
                htmlFor="license"
                className={`btn-primary w-full cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}
              >
                <Upload size={16} />
                {busy
                  ? 'Uploading…'
                  : status?.has_document
                    ? 'Replace document'
                    : 'Choose file'}
              </label>
              <p className="mt-2 text-xs text-ink-faint">
                JPG, PNG, WebP, or PDF, up to 8 MB. Stored privately and visible only
                to administrators reviewing your application.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-sm text-ink-faint">
          Questions about your application? Email support@openup.ph.
        </p>
      </div>
    </div>
  );
}
