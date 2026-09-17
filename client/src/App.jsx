import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  LayoutGrid, MessageCircleHeart, MessagesSquare, CalendarPlus, Users,
  LineChart, Mic, BookOpen, CalendarCheck, UserCheck, Flame, Wallet, ClipboardCheck, Activity,
  FileText, ShieldCheck, Settings, CreditCard, Bell,
} from 'lucide-react';

import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppShell from './layouts/AppShell.jsx';

import Landing from './pages/public/Landing.jsx';
import Login from './pages/public/Login.jsx';
import Register from './pages/public/Register.jsx';
import ForgotPassword from './pages/public/ForgotPassword.jsx';
import ResetPassword from './pages/public/ResetPassword.jsx';
import Dashboard from './pages/resident/Dashboard.jsx';
import Journal from './pages/resident/Journal.jsx';
import Book from './pages/resident/Book.jsx';
import Sessions from './pages/resident/Sessions.jsx';
import PsychologistDashboard from './pages/psychologist/Dashboard.jsx';
import PendingVerification from './pages/psychologist/PendingVerification.jsx';
import Requests from './pages/psychologist/Requests.jsx';
import Clients from './pages/psychologist/Clients.jsx';
import PsychReports from './pages/psychologist/Reports.jsx';
import PsychAlerts from './pages/psychologist/Alerts.jsx';
import LguDashboard from './pages/lgu/Dashboard.jsx';
import Budget from './pages/lgu/Budget.jsx';
import Directory from './pages/lgu/Directory.jsx';
import Governance from './pages/lgu/Governance.jsx';
import LguReports from './pages/lgu/Reports.jsx';
import LguHeatmap from './pages/lgu/Heatmap.jsx';
import LguAlerts from './pages/lgu/Alerts.jsx';
import AiEffectiveness from './pages/lgu/AiEffectiveness.jsx';
import AdminDashboard from './pages/admin/Dashboard.jsx';
import SessionRoom from './pages/SessionRoom.jsx';
import Chat from './pages/Chat.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Notifications from './pages/Notifications.jsx';
import Companion from './pages/resident/Companion.jsx';
import Groups from './pages/Groups.jsx';
import Resources from './pages/resident/Resources.jsx';
import Assessment from './pages/resident/Assessment.jsx';
import Community from './pages/resident/Community.jsx';
import Privacy from './pages/resident/Privacy.jsx';
import Verification from './pages/admin/Verification.jsx';
import Credits from './pages/admin/Credits.jsx';
import Subscriptions from './pages/admin/Subscriptions.jsx';
import Appointments from './pages/admin/Appointments.jsx';
import ResourcesAdmin from './pages/admin/Resources.jsx';
import UsersAdmin from './pages/admin/Users.jsx';
import LguAccounts from './pages/admin/LguAccounts.jsx';
import Moderation from './pages/admin/Moderation.jsx';
import SettingsPage from './pages/admin/Settings.jsx';
import AiCrisis from './pages/admin/AiCrisis.jsx';
import Analytics from './pages/admin/Analytics.jsx';

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
  { to: '/app/assessment', label: 'Check-in', icon: ClipboardCheck },
  { to: '/app/journal',   label: 'Journal',   icon: Mic },
  { to: '/app/community', label: 'Community', icon: MessagesSquare },
  { to: '/app/resources', label: 'Resources', icon: BookOpen },
  { to: '/app/privacy',   label: 'Privacy',   icon: ShieldCheck },
];

const PSYCHOLOGIST_NAV = [
  { to: '/psychologist',           label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/psychologist/alerts',    label: 'Alerts',       icon: Bell },
  { to: '/psychologist/requests',  label: 'Requests',     icon: CalendarCheck },
  { to: '/psychologist/sessions',  label: 'Sessions',     icon: CalendarPlus },
  { to: '/psychologist/chat',      label: 'Chat',         icon: MessagesSquare },
  { to: '/psychologist/groups',    label: 'Groups',       icon: Users },
  { to: '/psychologist/community', label: 'Community',    icon: MessagesSquare },
  { to: '/psychologist/clients',   label: 'Clients',      icon: Users },
  { to: '/psychologist/reports',   label: 'Reports',      icon: FileText },
];

const LGU_NAV = [
  { to: '/lgu',          label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/lgu/heatmap',  label: 'Heatmap',      icon: Flame },
  { to: '/lgu/alerts',   label: 'Risk alerts',  icon: Bell },
  { to: '/lgu/budget',   label: 'Budget',       icon: Wallet },
  { to: '/lgu/directory', label: 'Psychologists', icon: UserCheck },
  { to: '/lgu/ai-tracker', label: 'AI tracker',  icon: Activity },
  { to: '/lgu/governance', label: 'Governance',  icon: ShieldCheck },
  { to: '/lgu/reports',  label: 'Reports',      icon: FileText },
];

const ADMIN_NAV = [
  { to: '/admin',               label: 'Dashboard',    icon: LayoutGrid, end: true },
  { to: '/admin/verification',  label: 'Verification',  icon: UserCheck },
  { to: '/admin/users',         label: 'Users',         icon: Users },
  { to: '/admin/lgu',           label: 'LGU accounts',  icon: ShieldCheck },
  { to: '/admin/credits',       label: 'Care Credits',  icon: CreditCard },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: FileText },
  { to: '/admin/appointments',  label: 'Appointments',  icon: CalendarCheck },
  { to: '/admin/resources',     label: 'Resources',     icon: BookOpen },
  { to: '/admin/moderation',    label: 'Moderation',    icon: Flame },
  { to: '/admin/ai-crisis',     label: 'Crisis',        icon: Bell },
  { to: '/admin/analytics',     label: 'Analytics',     icon: Activity },
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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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
            <Route path="chat" element={<Chat />} />
            <Route path="companion" element={<Companion />} />
            <Route path="groups" element={<Groups />} />
            <Route path="resources" element={<Resources />} />
            <Route path="assessment" element={<Assessment />} />
            <Route path="community" element={<Community />} />
            <Route path="privacy" element={<Privacy />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<ComingSoon />} />
          </Route>

          {/* Counseling session — full screen, no shell around the call */}
          <Route
            path="/app/session/:bookingId"
            element={
              <ProtectedRoute roles={['resident']}>
                <SessionRoom />
              </ProtectedRoute>
            }
          />
          <Route
            path="/psychologist/session/:bookingId"
            element={
              <ProtectedRoute roles={['psychologist']}>
                <SessionRoom />
              </ProtectedRoute>
            }
          />

          {/* Group session rooms */}
          <Route
            path="/app/group-session/:bookingId"
            element={
              <ProtectedRoute roles={['resident']}>
                <SessionRoom kind="group" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/psychologist/group-session/:bookingId"
            element={
              <ProtectedRoute roles={['psychologist']}>
                <SessionRoom kind="group" />
              </ProtectedRoute>
            }
          />

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
            <Route path="chat" element={<Chat />} />
            <Route path="groups" element={<Groups />} />
            <Route path="community" element={<Community />} />
            <Route path="clients" element={<Clients />} />
            <Route path="reports" element={<PsychReports />} />
            <Route path="alerts" element={<PsychAlerts />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<ComingSoon />} />
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
            <Route path="budget" element={<Budget />} />
            <Route path="directory" element={<Directory />} />
            <Route path="governance" element={<Governance />} />
            <Route path="reports" element={<LguReports />} />
            <Route path="heatmap" element={<LguHeatmap />} />
            <Route path="alerts" element={<LguAlerts />} />
            <Route path="ai-tracker" element={<AiEffectiveness />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<ComingSoon />} />
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
            <Route path="credits" element={<Credits />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="resources" element={<ResourcesAdmin />} />
            <Route path="users" element={<UsersAdmin />} />
            <Route path="lgu" element={<LguAccounts />} />
            <Route path="moderation" element={<Moderation />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ai-crisis" element={<AiCrisis />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="ai-tracker" element={<AiEffectiveness />} />
            <Route path="*" element={<ComingSoon />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
