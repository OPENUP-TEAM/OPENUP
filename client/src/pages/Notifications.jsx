import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import {
  Bell, CalendarCheck, MessageSquare, Settings as Cog, CheckCheck, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

/**
 * Notifications.
 *
 * The bell in the sidebar pointed here for every role and the page did not
 * exist, so notifications were written, pushed over the socket, counted in
 * a badge, and then unreadable.
 *
 * Grouped by day rather than listed flat: the useful question is "what
 * happened since I last looked", and a date beside every row answers it
 * worse than a heading does.
 */
const TYPE = {
  session: { icon: CalendarCheck, tone: 'text-tide-500' },
  message: { icon: MessageSquare, tone: 'text-tide-500' },
  system:  { icon: Cog,           tone: 'text-ink-faint' },
};

function dayLabel(iso) {
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE d MMMM');
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    api('/notifications')
      .then(({ notifications, unread }) => {
        setItems(notifications);
        setUnread(unread);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Anything arriving while this page is open should appear without a
    // reload; the socket already carries it.
    const socket = getSocket();
    const onNew = (n) => {
      setItems((prev) => [n, ...prev]);
      setUnread((u) => u + 1);
    };
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, []);

  const markRead = async (n) => {
    if (n.is_read) return;
    setItems((prev) =>
      prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x))
    );
    setUnread((u) => Math.max(0, u - 1));
    await api(`/notifications/${n.notification_id}/read`, { method: 'PATCH' }).catch(() => {});
  };

  const markAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    await api('/notifications/read-all', { method: 'PATCH' }).catch(() => {});
  };

  // Group into days, preserving the order the server returned.
  const groups = items.reduce((acc, n) => {
    const key = dayLabel(n.created_at);
    (acc[key] ??= []).push(n);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {unread > 0
              ? `${unread} unread`
              : 'Nothing unread.'}
          </p>
        </div>
        {unread > 0 && (
          <button onClick={markAll} className="btn-quiet h-10 px-4">
            <CheckCheck size={15} />
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-mood-1 bg-mood-1/10 rounded-[10px] px-3.5 py-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <Bell size={20} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm text-ink-soft">
            Nothing yet. You will hear about session requests, replies and anything that
            needs your attention.
          </p>
        </div>
      ) : (
        Object.entries(groups).map(([day, list]) => (
          <section key={day}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {day}
            </h2>
            <ul className="mt-2.5 card divide-y divide-line">
              {list.map((n) => {
                const t = TYPE[n.type] ?? TYPE.system;
                const Icon = t.icon;

                const body = (
                  <div className={`px-4 py-3.5 flex items-start gap-3 ${
                    n.is_read ? '' : 'bg-tide-50/60'
                  }`}>
                    <Icon size={17} className={`shrink-0 mt-0.5 ${t.tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-relaxed ${n.is_read ? '' : 'font-medium'}`}>
                        {n.message}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-faint tabular-nums">
                        {format(parseISO(n.created_at), 'h:mm a')}
                      </p>
                    </div>
                    {!n.is_read && (
                      <span className="w-2 h-2 rounded-full bg-tide-700 shrink-0 mt-2"
                            aria-label="Unread" />
                    )}
                    {n.link && <ArrowRight size={15} className="shrink-0 mt-0.5 text-ink-faint" />}
                  </div>
                );

                // A notification with a link should take you there and mark
                // itself read on the way, rather than needing two actions.
                return (
                  <li key={n.notification_id}>
                    {n.link ? (
                      <Link to={n.link} onClick={() => markRead(n)} className="block">
                        {body}
                      </Link>
                    ) : (
                      <button onClick={() => markRead(n)} className="w-full text-left">
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
