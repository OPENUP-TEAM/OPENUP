import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { homeFor } from '../../components/ProtectedRoute.jsx';

// Figure 24: Authentication Sign-Up.
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [barangays, setBarangays] = useState([]);
  const [form, setForm] = useState({
    role: 'resident', name: '', email: '', password: '',
    barangay_id: '', display_alias: '', license_no: '', specialization: '', languages: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/barangays').then(({ barangays }) => setBarangays(barangays)).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await register(form);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.details?.[0]?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const isPsychologist = form.role === 'psychologist';

  return (
    <div className="min-h-screen grid place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-lg font-extrabold tracking-tight">OpenUp</Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Create your account</h1>

        <div className="mt-6 grid grid-cols-2 gap-2 p-1 bg-paper-sunk rounded-pill">
          {[['resident', 'Resident'], ['psychologist', 'Psychologist']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setForm({ ...form, role: value })}
              className={`h-9 rounded-pill text-sm font-semibold ${
                form.role === value ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" required className="field" value={form.name} onChange={set('name')} />
          </div>
          <div>
            <label className="label" htmlFor="barangay">Barangay</label>
            <select id="barangay" required className="field" value={form.barangay_id}
                    onChange={set('barangay_id')}>
              <option value="">Choose your barangay</option>
              {barangays.map((b) => (
                <option key={b.barangay_id} value={b.barangay_id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" required className="field"
                   value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} className="field"
                   value={form.password} onChange={set('password')} />
            <p className="mt-1.5 text-xs text-ink-faint">At least 8 characters.</p>
          </div>

          {!isPsychologist && (
            <div>
              <label className="label" htmlFor="alias">Display name for anonymous posts</label>
              <input id="alias" className="field" placeholder="Blue Heron"
                     value={form.display_alias} onChange={set('display_alias')} />
              <p className="mt-1.5 text-xs text-ink-faint">
                This is what others see in chat and community posts. Leave it blank to stay unnamed.
              </p>
            </div>
          )}

          {isPsychologist && (
            <>
              <div>
                <label className="label" htmlFor="license">PRC license number</label>
                <input id="license" required className="field" placeholder="PSY-12345"
                       value={form.license_no} onChange={set('license_no')} />
              </div>
              <div>
                <label className="label" htmlFor="spec">Specialization</label>
                <input id="spec" className="field" placeholder="Anxiety and depression"
                       value={form.specialization} onChange={set('specialization')} />
              </div>
              <div>
                <label className="label" htmlFor="langs">Languages you counsel in</label>
                <input id="langs" className="field" placeholder="Bisaya, Filipino, English"
                       value={form.languages} onChange={set('languages')} />
              </div>
              <p className="text-xs text-ink-faint bg-paper-sunk rounded-[10px] px-3 py-2.5">
                An administrator reviews your license before your profile goes live. You will get
                an email once it is approved.
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3 py-2.5">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-soft">
          Already registered? <Link to="/login" className="font-semibold text-tide-700 underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
