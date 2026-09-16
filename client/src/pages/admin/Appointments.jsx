import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeftRight, X, Wallet, Clock, Filter } from 'lucide-react';
import { api } from '../../lib/api.js';

// Module: Appointment Management.
const STATUS = {
  pending:   { label: 'Pending',   tone: 'text-mood-3 bg-mood-3/12' },
  confirmed: { label: 'Confirmed', tone: 'text-mood-5 bg-mood-5/12' },
  declined:  { label: 'Declined',  tone: 'text-mood-1 bg-mood-1/12' },
  cancelled: { label: 'Cancelled', tone: 'text-ink-faint bg-paper-sunk' },
  completed: { label: 'Completed', tone: 'text-tide-700 bg-tide-100' },
  no_show:   { label: 'Missed',    tone: 'text-mood-2 bg-mood-2/12' },
};

export default function Appointments() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Reassignment is a two-step flow: pick a psychologist, give a reason.
  const [panel, setPanel] = useState(null); // { booking, mode: 'reassign'|'cancel' }
  const [alternatives, setAlternatives] = useState([]);
  const [chosen, setChosen] = useState('');
  const [reason, setReason] = useState('');

  const load = () => {
    const qs = status ? `?status=${status}` : '';
    api(`/appointments${qs}`).then(setData).catch((err) => setError(err.message));
  };

  useEffect(() => { load(); }, [status]);

  const openReassign = async (b) => {
    setPanel({ booking: b, mode: 'reassign' });
    setChosen('');
    setReason('');
    setAlternatives([]);
    try {
      const { psychologists } = await api(`/appointments/${b.booking_id}/alternatives`);
      setAlternatives(psychologists);
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async () => {
    const b = panel.booking;
    setBusyId(b.booking_id);
    setError('');
    setNotice('');
    try {
      if (panel.mode === 'reassign') {
        const r = await api(`/appointments/${b.booking_id}/reassign`, {
          method: 'PATCH',
          body: { psychologist_id: chosen, reason: reason.trim() },
        });
        setNotice(`Session moved to ${r.psychologist}.`);
      } else {
        const r = await api(`/appointments/${b.booking_id}/cancel`, {
          method: 'PATCH',
          body: { reason: reason.trim() },
        });
        setNotice(
          r.credit_returned
            ? 'Appointment cancelled and the Care Credit returned.'
            : 'Appointment cancelled.'
        );
      }
      setPanel(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const canSubmit =
    reason.trim().length >= 5 && (panel?.mode === 'cancel' || chosen);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Appointments</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every session on the platform. Cancelling returns the resident's Care Credit;
          reassigning keeps it.
        </p>
      </div>

      {data?.counts && (
        <section className="grid gap-4 sm:grid-cols-4">
          {['pending', 'confirmed', 'completed', 'cancelled'].map((k) => (
            <div key={k} className="card p-5">
              <p className="text-sm text-ink-soft">{STATUS[k].label}</p>
              <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">
                {data.counts[k] ?? 0}
              </p>
            </div>
          ))}
        </section>
      )}

      {notice && (
        <p className="text-sm text-tide-900 bg-tide-100 rounded-[10px] px-3.5 py-3">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Filter size={15} className="text-ink-faint" />
        <div className="flex gap-1 p-1 bg-paper-sunk rounded-pill">
          {[['', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'],
            ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setStatus(k)}
              className={`h-9 px-3.5 rounded-pill text-sm font-semibold ${
                status === k ? 'bg-paper-raised shadow-lift' : 'text-ink-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {(data?.appointments ?? []).length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-soft">No appointments match that filter.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.appointments.map((b) => {
            const st = STATUS[b.status] ?? STATUS.pending;
            const editable = ['pending', 'confirmed'].includes(b.status);
            return (
              <li key={b.booking_id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${st.tone}`}>
                      {st.label}
                    </span>
                    <h3 className="mt-2.5 font-bold">
                      {b.display_alias || b.resident_name}
                      <span className="font-normal text-ink-soft"> with </span>
                      {b.psychologist_name}
                    </h3>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-soft">
                      <Clock size={13} />
                      {format(parseISO(b.schedule), "EEE d MMM yyyy, h:mm a")}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {b.barangay_name} · {b.duration_min} min ·{' '}
                      {b.session_type === 'group' ? 'Group' : 'One on one'}
                    </p>
                    {b.covered_by_credit && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-tide-700">
                        <Wallet size={13} />
                        Care Credit · payment {b.payment_status}
                      </p>
                    )}
                  </div>

                  {editable && (
                    <div className="flex flex-col gap-2 shrink-0 min-w-[130px]">
                      <button onClick={() => openReassign(b)} className="btn-quiet h-9 px-4">
                        <ArrowLeftRight size={14} />
                        Reassign
                      </button>
                      <button
                        onClick={() => {
                          setPanel({ booking: b, mode: 'cancel' });
                          setReason('');
                        }}
                        className="btn-quiet h-9 px-4"
                      >
                        <X size={14} />
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {panel && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 px-5">
          <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <h2 className="text-lg font-bold">
              {panel.mode === 'reassign' ? 'Reassign this session' : 'Cancel this session'}
            </h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              {format(parseISO(panel.booking.schedule), "EEE d MMM, h:mm a")} ·{' '}
              {panel.booking.display_alias || panel.booking.resident_name}
            </p>

            {panel.mode === 'reassign' && (
              <div className="mt-5">
                <span className="label">Move to</span>
                {alternatives.length === 0 ? (
                  <p className="text-sm text-ink-soft bg-paper-sunk rounded-[10px] px-3.5 py-3">
                    No other verified psychologist is free and working at that time. Cancel the
                    session instead, or ask the resident to rebook.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {alternatives.map((p) => (
                      <li key={p.psychologist_id}>
                        <label className="flex items-start gap-3 card p-3 cursor-pointer">
                          <input
                            type="radio"
                            name="alt"
                            value={p.psychologist_id}
                            checked={String(chosen) === String(p.psychologist_id)}
                            onChange={(e) => setChosen(e.target.value)}
                            className="mt-1 accent-tide-700"
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-sm">{p.name}</span>
                            <span className="block text-xs text-ink-faint">
                              {p.specialization || 'General'} · {p.languages || '—'}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <label className="label mt-5" htmlFor="reason">
              Reason
            </label>
            <textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                panel.mode === 'reassign'
                  ? 'Dr. Santos is unwell and cannot take sessions this week.'
                  : 'The psychologist is unavailable and no replacement was free.'
              }
              className="w-full px-3.5 py-2.5 rounded-[10px] border border-line-strong bg-paper-raised text-sm placeholder:text-ink-faint focus:border-tide-500"
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              The resident sees this, so make it something that explains itself.
            </p>

            <div className="mt-5 flex gap-2">
              <button
                onClick={submit}
                disabled={!canSubmit || busyId === panel.booking.booking_id}
                className="btn-primary flex-1"
              >
                {panel.mode === 'reassign' ? 'Reassign' : 'Cancel session'}
              </button>
              <button onClick={() => setPanel(null)} className="btn-quiet px-5">
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
