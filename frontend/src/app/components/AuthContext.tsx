'use client';

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { API_URL, isDesktop, fetchJson, TOKEN_KEY } from '../lib/api';

interface AuthContextType {
  user: { battletag: string } | null;
  loading: boolean;
  login: (clientId?: string, clientSecret?: string) => void;
  logout: (switchAccount?: boolean) => void;
  checkCredentialsStatus: () => Promise<{ globally_configured: boolean }>;
  setSystemCredentials: (clientId: string, clientSecret: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: (switchAccount?: boolean) => {},
  checkCredentialsStatus: async () => ({ globally_configured: false }),
  setSystemCredentials: async () => false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ battletag: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const data = await fetchJson<{ battletag: string }>(`${API_URL}/api/auth/me`);
        if (data.battletag) {
          setUser({ battletag: data.battletag });
        }
      } catch (err: any) {
        if (err.status !== 401) {
          console.error('Auth check failed:', err);
        }
        // If 401/error, consider user logged out
        if (typeof window !== 'undefined' && localStorage.getItem(TOKEN_KEY)) {
           localStorage.removeItem(TOKEN_KEY);
        }
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const checkCredentialsStatus = useCallback(async () => {
    try {
      return await fetchJson<{ globally_configured: boolean }>(
        `${API_URL}/api/auth/bnet/credentials-status`
      );
    } catch (err) {
      console.error('Failed to check credentials status:', err);
    }
    return { globally_configured: false }; // Fallback to avoid dead-end if request fails
  }, []);

  const setSystemCredentials = useCallback(async (clientId: string, clientSecret: string) => {
    try {
      const res = await fetch(`${API_URL}/api/system/blizzard/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to set system credentials:', err);
      return false;
    }
  }, []);

  const login = useCallback(async (clientId?: string, clientSecret?: string) => {
    const flowId = crypto.randomUUID();
    let url = `${API_URL}/api/auth/bnet/login?flow_id=${flowId}`;

    if (clientId && clientSecret) {
      url += `&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(
        clientSecret
      )}`;
    }

    if (isDesktop) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        console.log('Opening isolated auth window:', url);

        // Use double-encoding for the ref URL to ensure Blizzard's logout redirect works correctly
        await invoke('open_auth_window', { url: encodeURIComponent(url) });

        // Start polling for token
        startPolling(flowId);
        return;
      } catch (err) {
        console.error('Failed to use Tauri internal window, falling back to shell:', err);
        try {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(url);
          startPolling(flowId);
          return;
        } catch (shellErr) {
          console.error('Shell fallback failed:', shellErr);
        }
      }
    }

    console.log('Initiating login redirect to:', url);
    window.location.assign(url);
  }, []);

  const startPolling = (flowId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/poll?flow_id=${flowId}`);
        if (res.ok) {
          const { token } = await res.json();
          if (token) {
            localStorage.setItem(TOKEN_KEY, token);
            clearInterval(interval);
            // Refresh user state
            const data = await fetchJson<{ battletag: string }>(`${API_URL}/api/auth/me`);
            setUser({ battletag: data.battletag });
          }
        }
      } catch (err) {
        console.error('Polling failed:', err);
      }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const logout = useCallback((switchAccount?: boolean) => {
    const performLocalLogout = () => {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
      window.location.href = '/';
    };

    fetchJson(`${API_URL}/api/auth/logout`, { method: 'POST' })
      .then(performLocalLogout)
      .catch((err) => {
        console.error('Backend logout failed:', err);
        performLocalLogout();
      });
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, checkCredentialsStatus, setSystemCredentials }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
