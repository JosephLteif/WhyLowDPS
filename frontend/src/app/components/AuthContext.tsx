'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  API_URL,
  fetchJson,
  isDesktop,
  isNetworkUnavailableError,
  saveBlizzardCredentialProfile,
  setSessionToken,
} from '../lib/api';

interface AuthContextType {
  user: { battletag: string } | null;
  loading: boolean;
  lightMode: boolean;
  enableLightMode: () => void;
  disableLightMode: () => void;
  login: (clientId?: string, clientSecret?: string, credentialId?: string) => Promise<void>;
  logout: (switchAccount?: boolean) => void;
  checkCredentialsStatus: () => Promise<{ globally_configured: boolean }>;
  setSystemCredentials: (clientId: string, clientSecret: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  lightMode: false,
  enableLightMode: () => {},
  disableLightMode: () => {},
  login: async () => {},
  logout: () => {
  },
  checkCredentialsStatus: async () => ({ globally_configured: false }),
  setSystemCredentials: async () => false,
});

let authCheckInFlight: Promise<{ battletag: string } | null> | null = null;
const LIGHT_MODE_KEY = 'whylowdps_light_mode';

async function fetchCurrentUserOnce(): Promise<{ battletag: string } | null> {
  if (!authCheckInFlight) {
    authCheckInFlight = (async () => {
      try {
        const data = await fetchJson<{ battletag: string }>(`${API_URL}/api/auth/me`);
        if (data?.battletag) {
          return { battletag: data.battletag };
        }
        return null;
      } finally {
        authCheckInFlight = null;
      }
    })();
  }
  return authCheckInFlight;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ battletag: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    setLightMode(localStorage.getItem(LIGHT_MODE_KEY) === '1');
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      if (lightMode) {
        setSessionToken(null);
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const data = await fetchCurrentUserOnce();
        setUser(data);
      } catch (err: any) {
        if (err.status !== 401 && !isNetworkUnavailableError(err)) {
          console.error('Auth check failed:', err);
        }
        // If 401/error, consider user logged out
        setSessionToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [lightMode]);

  const checkCredentialsStatus = useCallback(async () => {
    if (lightMode) return { globally_configured: false };
    try {
      return await fetchJson<{ globally_configured: boolean }>(
        `${API_URL}/api/auth/bnet/credentials-status`
      );
    } catch (err) {
      if (!isNetworkUnavailableError(err)) {
        console.error('Failed to check credentials status:', err);
      }
    }
    return { globally_configured: false }; // Fallback to avoid dead-end if request fails
  }, [lightMode]);

  const enableLightMode = useCallback(() => {
    localStorage.setItem(LIGHT_MODE_KEY, '1');
    setSessionToken(null);
    setUser(null);
    setLightMode(true);
    setLoading(false);
  }, []);

  const disableLightMode = useCallback(() => {
    localStorage.removeItem(LIGHT_MODE_KEY);
    setLightMode(false);
    setLoading(true);
  }, []);

  const setSystemCredentials = useCallback(async (clientId: string, clientSecret: string) => {
    try {
      await saveBlizzardCredentialProfile({
        name: 'Main credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      return true;
    } catch (err) {
      console.error('Failed to set system credentials:', err);
      return false;
    }
  }, []);

  const login = useCallback(
    async (clientId?: string, clientSecret?: string, credentialId?: string) => {
      localStorage.removeItem(LIGHT_MODE_KEY);
      setLightMode(false);
      const flowId = crypto.randomUUID();
      let url = `${API_URL}/api/auth/bnet/login?flow_id=${flowId}`;

      let selectedCredentialId = credentialId;
      if (!selectedCredentialId && clientId && clientSecret) {
        const profile = await saveBlizzardCredentialProfile({
          name: 'Login credentials',
          client_id: clientId,
          client_secret: clientSecret,
        });
        selectedCredentialId = profile.id;
      }
      if (selectedCredentialId) {
        url += `&credential_id=${encodeURIComponent(selectedCredentialId)}`;
      }

      if (isDesktop) {
        startPolling(flowId);
        void (async () => {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            // Pass raw URL; desktop command encodes once for Blizzard logout ref.
            await invoke('open_auth_window', { url });
          } catch (err) {
            console.error('Failed to use Tauri internal window, falling back to shell:', err);
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('open_external_url', { url });
            } catch (shellErr) {
              console.error('Shell fallback failed:', shellErr);
              window.location.assign(url);
            }
          }
        })();
        return;
      }

      window.location.assign(url);
    },
    [],
  );

  const startPolling = (flowId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/poll?flow_id=${flowId}`);
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const { token } = payload as { token?: string };
          if (token) {
            setSessionToken(token);
            clearInterval(interval);
            // Refresh user state
            const data = await fetchJson<{ battletag: string }>(`${API_URL}/api/auth/me`);
            setUser({ battletag: data.battletag });
          }
        } else {
          const message =
            (payload as { error?: string; details?: string })?.details ||
            (payload as { error?: string })?.error ||
            'Login flow failed.';
          void message;
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Polling failed:', err);
      }
    }, 2000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  };

  const logout = useCallback(() => {
    const performLocalLogout = () => {
      setSessionToken(null);
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
      value={{
        user,
        loading,
        lightMode,
        enableLightMode,
        disableLightMode,
        login,
        logout,
        checkCredentialsStatus,
        setSystemCredentials,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
