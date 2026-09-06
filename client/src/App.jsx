import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppShell from './layouts/AppShell.jsx';

import Landing from './pages/public/Landing.jsx';
import Login from './pages/public/Login.jsx';
import Register from './pages/public/Register.jsx';
import Dashboard from './pages/resident/Dashboard.jsx';
import LguDashboard from './pages/lgu/Dashboard.jsx';

const LGU_NAV = [
  { to: '/lgu',           label: 'Dashboard', end: true },
  { to: '/lgu/heatmap',   label: 'Heatmap' },
  { to: '/lgu/alerts',    label: 'Risk alerts' },
  { to: '/lgu/budget',    label: 'Budget' },
  { to: '/lgu/reports',   label: 'Reports' },
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
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            {/* Remaining resident modules mount here as they are built. */}
          </Route>

          {/* LGU */}
          <Route
            path="/lgu"
            element={
              <ProtectedRoute roles={['lgu', 'admin']}>
                <AppShell nav={LGU_NAV.map((i) => ({ ...i, icon: () => null }))} title="OpenUp LGU" />
              </ProtectedRoute>
            }
          >
            <Route index element={<LguDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
