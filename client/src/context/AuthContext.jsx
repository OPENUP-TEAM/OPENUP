import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on refresh.
  useEffect(() => {
    if (!getToken()) return setLoading(false);
    api('/auth/me')
      .then(({ user }) => { setUser(user); connectSocket(); })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const finish = useCallback(({ user, token }) => {
    setToken(token);
    setUser(user);
    connectSocket();
    return user;
  }, []);

  const login = useCallback(
    (email, password) =>
      api('/auth/login', { method: 'POST', body: { email, password } }).then(finish),
    [finish]
  );

  const register = useCallback(
    (payload) => api('/auth/register', { method: 'POST', body: payload }).then(finish),
    [finish]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
