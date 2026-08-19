'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  API_URL,
  LAN_ACCESS_REQUIRED_STORAGE_KEY,
  LAN_ACCESS_REVOKED_EVENT,
  fetchJson,
  isDesktop,
  isLanBrowser,
  isNetworkUnavailableError,
  saveBlizzardCredentialProfile,
  setSessionToken,
  switchBrowserUserScope,
} from '../lib/api';

export type AuthUser = {
  id: string;
  battletag: string;
  role: 'admin' | 'member';
  guest: boolean;
};

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  lanAccessRequired: boolean;
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
  lanAccessRequired: false,
  lightMode: false,
  enableLightMode: () => {},
  disableLightMode: () => {},
  login: async () => {},
  logout: () => {},
  checkCredentialsStatus: async () => ({ globally_configured: false }),
  setSystemCredentials: async () => false,
});

let authCheckInFlight: Promise<AuthUser | null> | null = null;
const LIGHT_MODE_KEY = 'whylowdps_light_mode';

async function fetchCurrentUserOnce(): Promise<AuthUser | null> {
  if (!authCheckInFlight) {
    authCheckInFlight = (async () => {
      try {
        const data = await fetchJson<AuthUser>(`${API_URL}/api/auth/me`);
        if (data?.battletag) {
          return data;
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [lanAccessRequired, setLanAccessRequired] = useState(false);
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    setLightMode(localStorage.getItem(LIGHT_MODE_KEY) === '1');
  }, []);

  useEffect(() => {
    if (localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1') {
      setLanAccessRequired(true);
    }
  }, []);

  useEffect(() => {
    const handleLanAccessRevoked = () => {
      localStorage.removeItem(LIGHT_MODE_KEY);
      localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
      setSessionToken(null);
      setUser(null);
      setLightMode(false);
      setLanAccessRequired(true);
    };

    window.addEventListener(LAN_ACCESS_REVOKED_EVENT, handleLanAccessRevoked);
    return () => window.removeEventListener(LAN_ACCESS_REVOKED_EVENT, handleLanAccessRevoked);
  }, []);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (response.status === 401) {
        const requestUrl = new URL(
          input instanceof Request ? input.url : input.toString(),
          window.location.href
        );
        if (
          requestUrl.origin === window.location.origin &&
          requestUrl.pathname.startsWith('/api/')
        ) {
          const responseText = await response
            .clone()
            .text()
            .catch(() => '');
          if (responseText.includes('LAN pairing required')) {
            window.dispatchEvent(new Event(LAN_ACCESS_REVOKED_EVENT));
          }
        }
      }
      return response;
    };

    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      if (isDesktop) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const storedToken = await Promise.race([
            invoke<string | null>('load_session_token'),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
          ]);
          if (storedToken) setSessionToken(storedToken);
        } catch (err) {
          console.error('Failed to restore desktop session:', err);
        }
      }
      const lanBrowser = isLanBrowser();
      const storedLanAccessRequired = localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1';
      if (lightMode && !lanBrowser && !storedLanAccessRequired) {
        await switchBrowserUserScope('local-guest');
        setSessionToken(null);
        setUser(null);
        setLanAccessRequired(false);
        setLoading(false);
        return;
      }
      if (lightMode && (lanBrowser || storedLanAccessRequired)) {
        localStorage.removeItem(LIGHT_MODE_KEY);
        setLightMode(false);
      }
      try {
        const data = await fetchCurrentUserOnce();
        if (data) await switchBrowserUserScope(data.id);
        setUser(data?.guest ? null : data);
        if (data?.guest) {
          localStorage.setItem(LIGHT_MODE_KEY, '1');
          setLightMode(true);
        }
        localStorage.removeItem(LAN_ACCESS_REQUIRED_STORAGE_KEY);
        setLanAccessRequired(false);
      } catch (err: any) {
        if (err.status !== 401 && !isNetworkUnavailableError(err)) {
          console.error('Auth check failed:', err);
        }
        // If 401/error, consider user logged out
        setSessionToken(null);
        setUser(null);
        const pairingRequired =
          !isDesktop && err?.status === 401 && err?.code === 'LAN_ACCESS_REQUIRED';
        if (pairingRequired) localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
        setLanAccessRequired((current) => current || pairingRequired);
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
    if (isLanBrowser() || localStorage.getItem(LAN_ACCESS_REQUIRED_STORAGE_KEY) === '1') {
      localStorage.setItem(LAN_ACCESS_REQUIRED_STORAGE_KEY, '1');
      setLanAccessRequired(true);
      return;
    }
    localStorage.setItem(LIGHT_MODE_KEY, '1');
    void switchBrowserUserScope('local-guest');
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
    []
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
            if (isDesktop) {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('save_session_token', { token });
            }
            clearInterval(interval);
            // Refresh user state
            const data = await fetchJson<AuthUser>(`${API_URL}/api/auth/me`);
            await switchBrowserUserScope(data.id);
            setUser(data);
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

  const logout = useCallback(
    (switchAccount = false) => {
      const performLocalLogout = () => {
        navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_USER_CACHE' });
        setSessionToken(null);
        if (isDesktop) {
          void import('@tauri-apps/api/core').then(({ invoke }) =>
            invoke('save_session_token', { token: null })
          );
        }
        setUser(null);
        if (switchAccount) {
          void login();
        } else {
          window.location.href = '/';
        }
      };

      fetchJson(`${API_URL}/api/auth/logout`, { method: 'POST' })
        .then(performLocalLogout)
        .catch((err) => {
          console.error('Backend logout failed:', err);
          performLocalLogout();
        });
    },
    [login]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        lanAccessRequired,
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
