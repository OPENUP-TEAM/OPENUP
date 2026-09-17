import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ShieldCheck, Lock, Check, Trash2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * A resident's own consent.
 *
 * Written so someone can actually decide. Each item says what is stored,
 * who sees it, and what changes if they turn it off — and turning off
 * barangay analytics genuinely removes them from the heatmap, rather than
 * recording a preference nothing reads.
 */
export default function Privacy() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [consents, setConsents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api('/governance/me').then(({ consents }) => setConsents(consents))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    api('/auth/me/deletion-summary').then(setSummary).catch(() => {});
  }, []);

  /**
   * Deleting your own account.
   *
   * Table 8 puts Delete Account under the administrator. RA 10173 gives a
   * data subject the right to erasure regardless, and asking someone else
   * to delete your mental health records is not a reasonable way to
   * exercise it.
   */
  const deleteAccount = async () => {
    setBusy('delete');
    setError('');
    try {
      const r = await api('/auth/me', {
        method: 'DELETE',
        body: { password, confirm: confirmWord },
      });
      // No confirmation screen: the account is gone, so there is nowhere
      // signed-in left to show one.
      logout();
      navigate('/', { replace: true, state: { deleted: r.message } });
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };

  const toggle = async (type, next) => {
    setBusy(type);
    setError('');
    setNotice('');
    try {
      const r = await api(`/governance/me/${type}`, {
        method: 'PUT',
        body: { is_granted: next },
      });
      if (r.effect) setNotice(r.effect);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Privacy</h1>
        <p className="mt-1 text-sm text-ink-soft">
          What OpenUp keeps, who can see it, and what you can switch off.
        </p>
      </div>

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {consents.map((c) => (
          <li key={c.consent_type} className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-bold">
                  {c.label}
                  {c.required && <Lock size={13} className="text-ink-faint" />}
                </h2>
                <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">
                  {c.description}
                </p>
                {c.recorded_at && (
                  <p className="mt-2 text-xs text-ink-faint">
                    {c.is_granted ? 'Agreed' : 'Withdrawn'}{' '}
                    {format(parseISO(c.recorded_at), 'd MMM yyyy')}
                  </p>
                )}
              </div>

              <div className="shrink-0">
                {c.required ? (
                  <span className="text-xs text-ink-faint">Needed to have an account</span>
                ) : (
                  <button
                    onClick={() => toggle(c.consent_type, !c.is_granted)}
                    disabled={busy === c.consent_type}
                    className={c.is_granted ? 'btn-quiet h-9 px-4 text-xs' : 'btn-primary h-9 px-4 text-xs'}
                  >
                    {busy === c.consent_type ? 'Saving…'
                      : c.is_granted ? 'Turn off' : 'Turn on'}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <ShieldCheck size={17} className="text-tide-500" />
          What nobody else can see
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft">
          {[
            'Your barangay never sees your name, your mood entries, your journals or your assessment answers.',
            'Your voice recordings are stored privately and can only be opened by you.',
            'A psychologist sees the display name you chose, not your real name, unless you share it.',
            'One psychologist cannot read another psychologist\u2019s notes about you.',
            'What you tell the companion is not passed to a psychologist when you ask to speak to someone.',
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <Check size={15} className="shrink-0 mt-0.5 text-mood-5" />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-4 pt-4 border-t border-line text-xs text-ink-faint leading-relaxed">
          One exception, and it matters: if something you write suggests you are in
          danger, a psychologist is told that an alert was raised. They are not shown what
          you wrote.
        </p>
      </section>

      {/* Right to erasure */}
      <section className="card p-5 border-mood-1/40">
        <h2 className="flex items-center gap-2 font-bold">
          <Trash2 size={17} className="text-mood-1" />
          Delete your account
        </h2>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          You can remove your account and everything in it at any time. This cannot be
          undone and nobody, including an administrator, can bring it back.
        </p>

        {summary && (
          <>
            <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 text-sm">
              {[
                ['Mood entries', summary.counts.mood_entries],
                ['Voice journals', summary.counts.voice_journals],
                ['Check-ins taken', summary.counts.assessments],
                ['Companion conversations', summary.counts.companion_chats],
                ['Sessions booked', summary.counts.bookings],
                ['Messages sent', summary.counts.messages],
                ['Community posts', summary.counts.posts],
              ].filter(([, n]) => n > 0).map(([label, n]) => (
                <li key={label} className="flex justify-between">
                  <span className="text-ink-soft">{label}</span>
                  <span className="font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>

            {summary.counts.upcoming_sessions > 0 && (
              <p className="mt-4 flex gap-2 text-sm bg-mood-2/10 rounded-[10px] px-3.5 py-3">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-mood-2" />
                You have {summary.counts.upcoming_sessions} session
                {summary.counts.upcoming_sessions === 1 ? '' : 's'} booked. Deleting your
                account cancels {summary.counts.upcoming_sessions === 1 ? 'it' : 'them'}.
              </p>
            )}

            {summary.counts.unused_credits > 0 && (
              <p className="mt-2 text-xs text-ink-faint">
                {summary.counts.unused_credits} unused Care Credit
                {summary.counts.unused_credits === 1 ? '' : 's'} will go back to your
                barangay rather than being lost.
              </p>
            )}
          </>
        )}

        {!deleting ? (
          <button onClick={() => setDeleting(true)} className="btn-quiet h-10 px-5 mt-5">
            <Trash2 size={15} />
            Delete my account
          </button>
        ) : (
          <div className="mt-5 pt-5 border-t border-line space-y-4">
            <div>
              <label className="label" htmlFor="pw">Your password</label>
              <input id="pw" type="password" className="field" value={password}
                     onChange={(e) => setPassword(e.target.value)}
                     autoComplete="current-password" />
            </div>
            <div>
              <label className="label" htmlFor="cw">
                Type DELETE to confirm
              </label>
              <input id="cw" className="field" value={confirmWord}
                     onChange={(e) => setConfirmWord(e.target.value)}
                     placeholder="DELETE" autoComplete="off" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={deleteAccount}
                disabled={!password || confirmWord !== 'DELETE' || busy === 'delete'}
                className="btn-primary bg-mood-1 hover:bg-mood-1/90"
              >
                {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                onClick={() => { setDeleting(false); setPassword(''); setConfirmWord(''); }}
                className="btn-quiet"
              >
                Keep my account
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
