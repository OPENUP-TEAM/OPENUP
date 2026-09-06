import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  LayoutGrid, MessageCircleHeart, MessagesSquare, CalendarPlus, Users,
  LineChart, Mic, BookOpen, Bell, LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';

// Figure 27: User Navigation Bar Menu.
const RESIDENT_NAV = [
  { to: '/app',            label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/app/companion',  label: 'Companion',    icon: MessageCircleHeart },
  { to: '/app/chat',       label: 'Chat',         icon: MessagesSquare },
  { to: '/app/book',       label: 'Book',         icon: CalendarPlus },
  { to: '/app/groups',     label: 'Groups',       icon: Users },
  { to: '/app/mood',       label: 'Mood',         icon: LineChart },
  { to: '/app/journal',    label: 'Journal',      icon: Mic },
  { to: '/app/community',  label: 'Community',    icon: Users },
  { to: '/app/resources',  label: 'Resources',    icon: BookOpen },
];

// Mobile keeps the five most-reached-for destinations.
const MOBILE_NAV = RESIDENT_NAV.filter((i) =>
  ['/app', '/app/companion', '/app/mood', '/app/book', '/app/journal'].includes(i.to)
);

export default function AppShell({ nav = RESIDENT_NAV, title = 'OpenUp' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api('/notifications').then(({ unread }) => setUnread(unread)).catch(() => {});
    const socket = getSocket();
    const onNew = () => setUnread((n) => n + 1);
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, []);

  const signOut = () => { logout(); navigate('/'); };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col border-r border-line bg-paper-sunk px-4 py-6">
        <div className="px-2 mb-8">
          <span className="text-lg font-extrabold tracking-tight">{title}</span>
          <p className="text-xs text-ink-faint mt-0.5">{user?.display_alias || user?.name}</p>
        </div>

        <nav className="flex-1 space-y-0.5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx('flex items-center gap-3 px-3 h-10 rounded-[10px] text-sm font-medium',
                  isActive ? 'bg-tide-100 text-tide-900' : 'text-ink-soft hover:bg-line/60')
              }
            >
              <Icon size={17} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="pt-4 mt-4 border-t border-line space-y-0.5">
          <NavLink
            to="/app/notifications"
            className="flex items-center gap-3 px-3 h-10 rounded-[10px] text-sm font-medium text-ink-soft hover:bg-line/60"
          >
            <Bell size={17} />
            Notifications
            {unread > 0 && (
              <span className="ml-auto text-xs font-semibold bg-tide-700 text-white rounded-pill px-2 py-0.5">
                {unread}
              </span>
            )}
          </NavLink>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 h-10 rounded-[10px] text-sm font-medium text-ink-soft hover:bg-line/60"
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-line">
        <span className="font-extrabold tracking-tight">{title}</span>
        <NavLink to="/app/notifications" className="relative p-2" aria-label="Notifications">
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-tide-700" />
          )}
        </NavLink>
      </header>

      <main className="px-4 py-6 lg:px-10 lg:py-10 pb-24 lg:pb-10 max-w-4xl w-full">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-paper-raised border-t border-line grid grid-cols-5">
        {MOBILE_NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx('flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium',
                isActive ? 'text-tide-700' : 'text-ink-faint')
            }
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
