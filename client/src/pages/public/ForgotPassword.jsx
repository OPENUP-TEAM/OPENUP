import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Forgotten password.
 *
 * The confirmation is the same whether or not the address has an account.
 * Telling someone "no account with that email" turns this form into a way
 * to find out who uses a mental health service, which is exactly what a
 * curious employer or neighbour would want to know.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSent(await api('/auth/forgot-password', { method: 'POST', body: { email } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen grid place-items-center px-5">
        <div className="w-full max-w-sm">
          <Link to="/" className="text-lg font-extrabold tracking-tight">OpenUp</Link>
          <MailCheck size={24} className="mt-8 text-tide-500" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{sent.message}</p>
          <p className="mt-3 text-sm text-ink-soft">
            The link works once and expires in 30 minutes.
          </p>

          {/* Only appears in development, where no provider is configured. */}
          {sent.dev_url && (
            <div className="mt-6 card p-4">
              <p className="text-xs font-semibold">Development only</p>
              <p className="mt-1 text-xs text-ink-soft">{sent.dev_note}</p>
              <Link to={sent.dev_url.replace(/^https?:\/\/[^/]+/, '')}
                    className="btn-primary h-9 px-4 mt-3 text-xs">
                Open the reset link
              </Link>
            </div>
          )}

          <Link to="/login" className="btn-quiet w-full mt-6">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-lg font-extrabold tracking-tight">OpenUp</Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Forgot your password</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Enter the email you signed up with and we will send you a link to set a new one.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required autoFocus className="field"
                   value={email} onChange={(e) => setEmail(e.target.value)}
                   autoComplete="email" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3 py-2.5">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          Remembered it? <Link to="/login" className="font-semibold text-tide-700 underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
