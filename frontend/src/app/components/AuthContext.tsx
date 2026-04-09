'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { API_URL } from '../lib/api';

interface AuthContextType {
  user: { battletag: string } | null;
  loading: boolean;
  login: (clientId?: string, clientSecret?: string) => void;
  logout: (switchAccount?: boolean) => void;
  checkCredentialsStatus: () => Promise<{ globally_configured: boolean }>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: (switchAccount?: boolean) => {},
  checkCredentialsStatus: async () => ({ globally_configured: true }),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ battletag: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
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

  const checkCredentialsStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/bnet/credentials-status`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.error('Failed to check credentials status:', err);
    }
    return { globally_configured: true }; // Fallback to avoid blocking if endpoint fails
  };

  const login = (clientId?: string, clientSecret?: string) => {
    let url = `${API_URL}/api/auth/bnet/login`;
    if (clientId && clientSecret) {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
      });
      url += `?${params.toString()}`;
    }
    window.location.href = url;
  };

  const logout = (switchAccount?: boolean) => {
    fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).then(() => {
      setUser(null);
      if (switchAccount) {
        // Redirect to Blizzard's logout to clear their SSO session
        window.location.href = 'https://battle.net/login/en/logout';
      } else {
        window.location.href = '/';
      }
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, checkCredentialsStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
