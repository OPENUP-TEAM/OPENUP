import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/** Landing page for each role after sign-in. */
export const homeFor = (role) =>
  ({ resident: '/app', psychologist: '/psychologist', lgu: '/lgu', admin: '/admin' }[role] || '/app');

export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-faint text-sm">
        Loading your account…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;

  return children;
}
