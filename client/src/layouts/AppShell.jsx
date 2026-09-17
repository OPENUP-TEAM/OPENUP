import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
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

export default function AppShell({ nav = RESIDENT_NAV, title = 'OpenUp' }) {
  // Mobile shows the first five destinations of whichever role is signed in.
  const mobileNav = nav.slice(0, 5);

  const { user, logout } = useAuth();
  const navigate = useNavigate();

  /**
   * Sidebar badges.
   *
   * One request for every count rather than each page fetching its own,
   * since the sidebar is always on screen. Refetched on a live
   * notification and every couple of minutes, because a crisis alert
   * raised while someone has the tab open should not wait for a reload.
   */
  const [counts, setCounts] = useState({});
  const { pathname } = useLocation();
  const debounce = useRef(null);

  useEffect(() => {
    const load = () =>
      api('/nav-counts').then(({ counts }) => setCounts(counts)).catch(() => {});

    // A burst of writes should cost one request, not one each.
    const loadSoon = () => {
      clearTimeout(debounce.current);
      debounce.current = setTimeout(load, 400);
    };

    load();

    // Polling is the fallback for things nobody on this device caused: an
    // alert raised by another resident, a request from someone else.
    const timer = setInterval(load, 120_000);

    const socket = getSocket();
    socket.on('notification:new', loadSoon);
    window.addEventListener('openup:counts', loadSoon);

    return () => {
      clearTimeout(debounce.current);
      clearInterval(timer);
      socket.off('notification:new', loadSoon);
      window.removeEventListener('openup:counts', loadSoon);
    };
  }, []);

  // Opening a page can clear its own unread count server-side, so the
  // badge is refetched on navigation rather than left stale.
  useEffect(() => {
    api('/nav-counts').then(({ counts }) => setCounts(counts)).catch(() => {});
  }, [pathname]);

  const unread = counts.notifications ?? 0;

  /** The last path segment is the badge key: /psychologist/alerts -> alerts. */
  const badgeFor = (to) => counts[to.split('/').filter(Boolean).pop()] ?? 0;

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
              {badgeFor(to) > 0 && (
                <span className={`ml-auto text-xs font-semibold rounded-pill px-2 py-0.5 ${
                  // Crisis alerts get the one saturated colour in the
                  // chrome, because they are the only thing here that may
                  // not wait until tomorrow.
                  to.endsWith('/alerts') || to.endsWith('/ai-crisis')
                    ? 'bg-mood-1 text-white'
                    : 'bg-tide-700 text-white'
                }`}>
                  {badgeFor(to)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="pt-4 mt-4 border-t border-line space-y-0.5">
          <NavLink
            to={`${nav[0]?.to ?? '/app'}/notifications`}
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
        <NavLink to={`${nav[0]?.to ?? '/app'}/notifications`} className="relative p-2" aria-label="Notifications">
          <Bell size={20} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-tide-700" />
          )}
        </NavLink>
      </header>

      {/*
        main owns the height and the scrolling. Pages that need to fill the
        screen (chat, the companion) use flex-1 instead of subtracting header
        and nav heights by hand, which was wrong at narrow widths and
        produced a second scrollbar.
        dvh rather than vh: on mobile browsers vh ignores the address bar.
      */}
      <main className="px-4 py-6 lg:px-10 lg:py-10 pb-24 lg:pb-10 max-w-4xl w-full
                       h-[calc(100dvh-3.5rem)] lg:h-dvh overflow-y-auto
                       flex flex-col min-h-0">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-paper-raised border-t border-line grid grid-cols-5">
        {mobileNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx('flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium',
                isActive ? 'text-tide-700' : 'text-ink-faint')
            }
          >
            <span className="relative">
              <Icon size={19} />
              {badgeFor(to) > 0 && (
                <span className={`absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full ${
                  to.endsWith('/alerts') ? 'bg-mood-1' : 'bg-tide-700'
                }`} />
              )}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
