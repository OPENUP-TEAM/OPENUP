import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { homeFor } from '../../components/ProtectedRoute.jsx';

// Figure 25: Authentication Login.
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Set when a session expired mid-task, so sign-in returns them there.
  const next = params.get('next');
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await login(form.email, form.password);
      navigate(next || homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen grid place-items-center px-5">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-lg font-extrabold tracking-tight">OpenUp</Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {next ? 'Your session expired. Sign in to pick up where you left off.'
                : 'Sign in to reach your support tools.'}
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required className="field"
                   value={form.email} onChange={set('email')} autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" required className="field"
                   value={form.password} onChange={set('password')} autoComplete="current-password" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3 py-2.5">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-sm">
          <Link to="/forgot-password" className="font-semibold text-tide-700 underline">
            Forgot your password?
          </Link>
        </p>

        <p className="mt-4 text-sm text-ink-soft">
          New here? <Link to="/register" className="font-semibold text-tide-700 underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
