import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { markIdleLogout, useIdleLogout } from './idle.js';

const AuthContext = createContext(null);
const USER_KEY = 'attendance_user';

// Cache the signed-in user so the app can start (and the offline scanner can
// run) without a round-trip to the server.
function loadCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveCachedUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore quota / privacy errors */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadCachedUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(({ user: fresh }) => {
        setUser(fresh);
        saveCachedUser(fresh);
      })
      .catch((err) => {
        // Offline: keep the session so the scanner keeps working. Only a real
        // auth failure (e.g. 401 / invalid token) clears the session.
        if (err?.network) {
          const cached = loadCachedUser();
          if (cached) setUser(cached);
        } else {
          setToken(null);
          saveCachedUser(null);
          setUser(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username, password) {
    const { token, user: next } = await api.login(username, password);
    setToken(token);
    setUser(next);
    saveCachedUser(next);
  }

  function logout() {
    setToken(null);
    saveCachedUser(null);
    setUser(null);
  }

  function updateUser(next) {
    setUser(next);
    saveCachedUser(next);
  }

  // Auto sign-out after 5 minutes without activity on the site.
  useIdleLogout({
    enabled: Boolean(user),
    onLogout: () => {
      logout();
      markIdleLogout();
    },
  });

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
