import { createContext, useContext, useState } from 'react';

const KEY = 'roots-user';
const AuthContext = createContext(null);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(load);

  const signIn = (u) => {
    setUser(u);
    try { localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* private mode */ }
  };
  const signOut = () => {
    setUser(null);
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  };

  return <AuthContext.Provider value={{ user, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
