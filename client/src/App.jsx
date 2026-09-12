import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutGrid, MessageCircleHeart, MessagesSquare, CalendarPlus, Users,
  LineChart, Mic, BookOpen, CalendarCheck, UserCheck, Flame, Wallet,
  FileText, ShieldCheck, Settings, CreditCard, Bell,
} from 'lucide-react';

import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppShell from './layouts/AppShell.jsx';

import Landing from './pages/public/Landing.jsx';
import Login from './pages/public/Login.jsx';
import Register from './pages/public/Register.jsx';
import Dashboard from './pages/resident/Dashboard.jsx';
import Journal from './pages/resident/Journal.jsx';
import Book from './pages/resident/Book.jsx';
import Sessions from './pages/resident/Sessions.jsx';
import PsychologistDashboard from './pages/psychologist/Dashboard.jsx';
import PendingVerification from './pages/psychologist/PendingVerification.jsx';
import Requests from './pages/psychologist/Requests.jsx';
import LguDashboard from './pages/lgu/Dashboard.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import Verification from './pages/admin/Verification.jsx';

// Figure 27: navigation per role. Items without a page yet are added as
// each module is built.
const RESIDENT_NAV = [
  { to: '/app',           label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/app/companion', label: 'Companion', icon: MessageCircleHeart },
  { to: '/app/chat',      label: 'Chat',      icon: MessagesSquare },
  { to: '/app/book',      label: 'Book',      icon: CalendarPlus },
  { to: '/app/sessions',  label: 'Sessions',  icon: CalendarCheck },
  { to: '/app/groups',    label: 'Groups',    icon: Users },
  { to: '/app/mood',      label: 'Mood',      icon: LineChart },
  { to: '/app/journal',   label: 'Journal',   icon: Mic },
  { to: '/app/resources', label: 'Resources', icon: BookOpen },
];

const PSYCHOLOGIST_NAV = [
  { to: '/psychologist',           label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/psychologist/requests',  label: 'Requests',     icon: CalendarCheck },
  { to: '/psychologist/sessions',  label: 'Sessions',     icon: CalendarPlus },
  { to: '/psychologist/clients',   label: 'Clients',      icon: Users },
  { to: '/psychologist/chat',      label: 'Chat',         icon: MessagesSquare },
  { to: '/psychologist/reports',   label: 'Reports',      icon: FileText },
];

const LGU_NAV = [
  { to: '/lgu',          label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/lgu/heatmap',  label: 'Heatmap',      icon: Flame },
  { to: '/lgu/alerts',   label: 'Risk alerts',  icon: Bell },
  { to: '/lgu/budget',   label: 'Budget',       icon: Wallet },
  { to: '/lgu/reports',  label: 'Reports',      icon: FileText },
];

const ADMIN_NAV = [
  { to: '/admin',               label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/admin/verification',  label: 'Verification',  icon: UserCheck },
  { to: '/admin/users',         label: 'Users',         icon: Users },
  { to: '/admin/lgu',           label: 'LGU accounts',  icon: ShieldCheck },
  { to: '/admin/credits',       label: 'Care Credits',  icon: CreditCard },
  { to: '/admin/settings',      label: 'Settings',      icon: Settings },
];

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Resident */}
          <Route
            path="/app"
            element={
              <ProtectedRoute roles={['resident']}>
                <AppShell nav={RESIDENT_NAV} title="OpenUp" />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="journal" element={<Journal />} />
            <Route path="book" element={<Book />} />
            <Route path="sessions" element={<Sessions />} />
          </Route>

          {/* Psychologist awaiting verification — no shell, no navigation */}
          <Route
            path="/psychologist/pending"
            element={
              <ProtectedRoute roles={['psychologist']}>
                <PendingVerification />
              </ProtectedRoute>
            }
          />

          {/* Psychologist */}
          <Route
            path="/psychologist"
            element={
              <ProtectedRoute roles={['psychologist']}>
                <AppShell nav={PSYCHOLOGIST_NAV} title="OpenUp Clinician" />
              </ProtectedRoute>
            }
          >
            <Route index element={<PsychologistDashboard />} />
            <Route path="requests" element={<Requests />} />
          </Route>

          {/* LGU */}
          <Route
            path="/lgu"
            element={
              <ProtectedRoute roles={['lgu']}>
                <AppShell nav={LGU_NAV} title="OpenUp LGU" />
              </ProtectedRoute>
            }
          >
            <Route index element={<LguDashboard />} />
          </Route>

          {/* Admin */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AppShell nav={ADMIN_NAV} title="OpenUp Admin" />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="verification" element={<Verification />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
