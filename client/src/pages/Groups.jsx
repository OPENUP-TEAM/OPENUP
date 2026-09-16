import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import { Users, Plus, Video, Clock, X, CalendarX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Figure 34: Group Counseling.
 *
 * One component for both sides. Residents browse and join; a verified
 * psychologist creates and facilitates.
 *
 * Nobody's name appears here. A group session is several residents in one
 * room, so anonymity matters more than in a one-on-one, not less.
 */
export default function Groups() {
  const { user } = useAuth();
  const isPsychologist = user?.role === 'psychologist';

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', topic: '', schedule: '', capacity: 10 });

  const load = () => {
    setLoading(true);
    api('/groups')
      .then(({ sessions }) => setSessions(sessions))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/groups', {
        method: 'POST',
        body: {
          title: form.title,
          topic: form.topic || undefined,
          schedule: new Date(form.schedule).toISOString(),
          capacity: form.capacity,
        },
      });
      setForm({ title: '', topic: '', schedule: '', capacity: 10 });
      setCreating(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const join = async (id) => {
    setBusyId(id);
    setError('');
    try {
      await api(`/groups/${id}/join`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err.message);
      // A full session means the list is stale.
      if (err.status === 409) load();
    } finally {
      setBusyId(null);
    }
  };

  const leave = async (id) => {
    setBusyId(id);
    try {
      await api(`/groups/${id}/join`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (id) => {
    setBusyId(id);
    try {
      await api(`/groups/${id}/cancel`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const upcoming = sessions.filter((s) => s.joinable);
  const past = sessions.filter((s) => !s.joinable);

  const Card = ({ g }) => {
    const full = g.seats_left === 0 && !g.i_joined;
    const started = isPast(parseISO(g.schedule));
    const roomPath = isPsychologist
      ? `/psychologist/group-session/${g.group_session_id}`
      : `/app/group-session/${g.group_session_id}`;

    return (
      <li className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-bold">{g.title}</h3>
            {g.topic && <p className="text-sm text-tide-700 font-medium">{g.topic}</p>}

            <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-soft">
              <Clock size={13} />
              {format(parseISO(g.schedule), "EEEE d MMMM, h:mm a")}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
              <Users size={13} />
              {g.joined} of {g.capacity} joined
              {!g.is_facilitator && ` · facilitated by ${g.facilitator_name}`}
            </p>

            {/* Seats as a bar: how full it is matters more than the number. */}
            <div className="mt-2.5 w-40 h-1.5 rounded-pill bg-paper-sunk overflow-hidden">
              <div
                className={`h-full rounded-pill ${full ? 'bg-mood-2' : 'bg-tide-500'}`}
                style={{ width: `${(g.joined / g.capacity) * 100}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0 min-w-[130px]">
            {(g.i_joined || g.is_facilitator) && (
              <Link to={roomPath} className="btn-primary h-9 px-4">
                <Video size={15} />
                {started ? 'Join now' : 'Open room'}
              </Link>
            )}

            {g.is_facilitator ? (
              <button
                onClick={() => cancel(g.group_session_id)}
                disabled={busyId === g.group_session_id}
                className="btn-quiet h-9 px-4"
              >
                <X size={14} />
                Cancel
              </button>
            ) : g.i_joined ? (
              <button
                onClick={() => leave(g.group_session_id)}
                disabled={busyId === g.group_session_id || started}
                className="btn-quiet h-9 px-4"
              >
                Leave
              </button>
            ) : (
              <button
                onClick={() => join(g.group_session_id)}
                disabled={busyId === g.group_session_id || full || started}
                className="btn-primary h-9 px-4"
              >
                {full ? 'Full' : busyId === g.group_session_id ? 'Joining…' : 'Join'}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Group sessions</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {isPsychologist
              ? 'Sessions you facilitate. Participants join under their display names.'
              : 'Several people, one psychologist, one topic. Nobody uses their real name.'}
          </p>
        </div>
        {isPsychologist && (
          <button onClick={() => setCreating((c) => !c)} className="btn-primary h-10 px-4">
            <Plus size={16} />
            New session
          </button>
        )}
      </div>

      {/* 3. Facilitate Session */}
      {isPsychologist && creating && (
        <form onSubmit={create} className="card p-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input
              id="title" required minLength={3} className="field"
              placeholder="Managing anxiety together"
              value={form.title} onChange={set('title')}
            />
          </div>
          <div>
            <label className="label" htmlFor="topic">Topic</label>
            <input
              id="topic" className="field" placeholder="Anxiety"
              value={form.topic} onChange={set('topic')}
            />
          </div>
          <div>
            <label className="label" htmlFor="capacity">Maximum participants</label>
            <input
              id="capacity" type="number" min={2} max={30} className="field"
              value={form.capacity} onChange={set('capacity')}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="schedule">When</label>
            <input
              id="schedule" type="datetime-local" required className="field"
              value={form.schedule} onChange={set('schedule')}
            />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary">Create session</button>
            <button type="button" onClick={() => setCreating(false)} className="btn-quiet">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarX size={20} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-soft">
            {isPsychologist
              ? 'You have not scheduled any group sessions yet.'
              : 'No group sessions scheduled. Check back soon.'}
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <ul className="space-y-3">
              {upcoming.map((g) => <Card key={g.group_session_id} g={g} />)}
            </ul>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="font-bold">Earlier</h2>
              <ul className="mt-3 space-y-3 opacity-70">
                {past.map((g) => <Card key={g.group_session_id} g={g} />)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
