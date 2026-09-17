import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api.js';

/**
 * Setting a new password from a reset link.
 *
 * The token is checked before the form is shown, so a dead link says so
 * immediately rather than after someone has typed a password twice.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [state, setState] = useState('checking'); // checking | ready | invalid | done
  const [hint, setHint] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setState('invalid');
      setError('That link is missing its token.');
      return;
    }
    api(`/auth/reset-password/check?token=${encodeURIComponent(token)}`)
      .then(({ email_hint }) => { setHint(email_hint); setState('ready'); })
      .catch((e) => { setError(e.message); setState('invalid'); });
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Those two do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, new_password: password },
      });
      setState('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-lg font-extrabold tracking-tight">OpenUp</Link>

        {state === 'checking' && (
          <p className="mt-8 text-sm text-ink-faint">Checking your link…</p>
        )}

        {state === 'invalid' && (
          <>
            <AlertCircle size={24} className="mt-8 text-mood-1" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">This link will not work</h1>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">{error}</p>
            <Link to="/forgot-password" className="btn-primary w-full mt-6">
              Ask for a new link
            </Link>
          </>
        )}

        {state === 'done' && (
          <>
            <CheckCircle2 size={24} className="mt-8 text-mood-5" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Password changed</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Sign in with your new password. Any other reset links you were sent no
              longer work.
            </p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full mt-6">
              Sign in
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            <KeyRound size={22} className="mt-8 text-tide-500" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Set a new password</h1>
            <p className="mt-1.5 text-sm text-ink-soft">
              For {hint}
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <div>
                <label className="label" htmlFor="pw">New password</label>
                <input id="pw" type="password" required minLength={8} autoFocus
                       className="field" value={password}
                       onChange={(e) => setPassword(e.target.value)}
                       autoComplete="new-password" />
                <p className="mt-1.5 text-xs text-ink-faint">At least 8 characters.</p>
              </div>
              <div>
                <label className="label" htmlFor="pw2">Again</label>
                <input id="pw2" type="password" required className="field" value={confirm}
                       onChange={(e) => setConfirm(e.target.value)}
                       autoComplete="new-password" />
              </div>

              {error && (
                <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3 py-2.5">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full"
                      disabled={busy || password.length < 8}>
                {busy ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
