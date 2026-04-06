'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_URL } from '../lib/api';

interface AuthContextType {
  user: { battletag: string } | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ battletag: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          if (data.battletag) {
            setUser({ battletag: data.battletag });
          }
        }
      } catch (err) {
        console.error('Auth check failed:', err);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = () => {
    // Redirect to the login endpoint which will then redirect to Blizzard
    window.location.href = `/api/auth/bnet/login`;
  };

  const logout = () => {
    fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'same-origin' }).then(() => {
      setUser(null);
      window.location.href = '/';
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
